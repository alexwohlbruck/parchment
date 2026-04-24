/**
 * Friends Service
 *
 * Handles friend relationships, invitations, and key sync.
 */

import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../schema/users.schema'
import { friendships, type Friendship } from '../schema/friendships.schema'
import {
  friendInvitations,
  type FriendInvitation,
  type InvitationDirection,
  type InvitationStatus,
} from '../schema/friend-invitations.schema'
import {
  resolveHandle,
  isLocalHandle,
  buildHandle,
  sendFederationMessage,
  getServerDomain,
  type FederationMessage,
} from './federation.service'
import { getUserHandle, getUserIdentity } from './user.service'
import { parseHandle } from '../lib/crypto'
import { generateId } from '../util'
import { emit } from './realtime/emit'

// Re-export for external use
export { getUserHandle }

// Type for remote user info (used by federation handlers)
export interface RemoteUserInfo {
  handle: string
  signingKey: string
  encryptionKey: string
  inbox: string
  name?: string
  picture?: string
}

/**
 * Send a friend invitation
 */
export async function sendFriendInvitation(
  fromUserId: string,
  toHandle: string,
  signature: string,
): Promise<{
  success: boolean
  invitation?: FriendInvitation
  error?: string
}> {
  // Get sender's handle
  const fromHandle = await getUserHandle(fromUserId)
  if (!fromHandle) {
    return {
      success: false,
      error: 'You must set an alias before sending friend invitations',
    }
  }

  // Cannot friend yourself
  if (fromHandle === toHandle) {
    return {
      success: false,
      error: 'You cannot send a friend invitation to yourself',
    }
  }

  // Check if already friends
  const existingFriendship = await db
    .select()
    .from(friendships)
    .where(
      and(
        eq(friendships.userId, fromUserId),
        eq(friendships.friendHandle, toHandle),
      ),
    )
    .limit(1)

  if (existingFriendship[0]) {
    return { success: false, error: 'You are already friends with this user' }
  }

  // Check for existing pending invitation
  const existingInvitation = await db
    .select()
    .from(friendInvitations)
    .where(
      and(
        eq(friendInvitations.fromHandle, fromHandle),
        eq(friendInvitations.toHandle, toHandle),
        eq(friendInvitations.status, 'pending'),
      ),
    )
    .limit(1)

  if (existingInvitation[0]) {
    return { success: false, error: 'Invitation already sent' }
  }

  // Resolve recipient
  const recipient = await resolveHandle(toHandle)
  if (!recipient) {
    return { success: false, error: 'Could not find user' }
  }

  const invitationId = generateId()
  const timestamp = new Date().toISOString()

  if (isLocalHandle(toHandle)) {
    // Local invitation
    const parsed = parseHandle(toHandle)
    if (!parsed) return { success: false, error: 'Invalid handle' }

    const localRecipient = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.alias, parsed.alias))
      .limit(1)

    if (!localRecipient[0]) {
      return { success: false, error: 'User not found' }
    }

    // Create outgoing invitation for sender
    const outgoingInvitation = await db
      .insert(friendInvitations)
      .values({
        id: invitationId,
        fromHandle,
        toHandle,
        localUserId: fromUserId,
        direction: 'outgoing' as InvitationDirection,
        status: 'pending' as InvitationStatus,
        originServer: getServerDomain(),
        signature,
      })
      .returning()

    // Create incoming invitation for recipient
    await db.insert(friendInvitations).values({
      id: generateId(),
      fromHandle,
      toHandle,
      localUserId: localRecipient[0].id,
      direction: 'incoming' as InvitationDirection,
      status: 'pending' as InvitationStatus,
      originServer: getServerDomain(),
      signature,
    })

    // Both users should see the new pending invitation immediately.
    await emit.friendship(
      'friend-invitation:created',
      outgoingInvitation[0],
      fromUserId,
      { userId: localRecipient[0].id },
    )

    return { success: true, invitation: outgoingInvitation[0] }
  } else {
    // Remote invitation - send via federation
    const message: FederationMessage = {
      type: 'FRIEND_INVITE',
      from: fromHandle,
      to: toHandle,
      timestamp,
      signature,
    }

    const sent = await sendFederationMessage(recipient.inbox, message)
    if (!sent) {
      return {
        success: false,
        error: 'Failed to send invitation to remote server',
      }
    }

    // Create local record of outgoing invitation
    const invitation = await db
      .insert(friendInvitations)
      .values({
        id: invitationId,
        fromHandle,
        toHandle,
        localUserId: fromUserId,
        direction: 'outgoing' as InvitationDirection,
        status: 'pending' as InvitationStatus,
        originServer: getServerDomain(),
        signature,
      })
      .returning()

    // Only the sender sees the new outgoing-invitation row on our server;
    // the remote side stores its own copy when federation delivers.
    await emit.friendship(
      'friend-invitation:created',
      invitation[0],
      fromUserId,
      { handle: toHandle },
    )

    return { success: true, invitation: invitation[0] }
  }
}

/**
 * Accept a friend invitation
 */
export async function acceptFriendInvitation(
  userId: string,
  invitationId: string,
  signature: string,
): Promise<{ success: boolean; error?: string }> {
  // Find the invitation
  const invitation = await db
    .select()
    .from(friendInvitations)
    .where(
      and(
        eq(friendInvitations.id, invitationId),
        eq(friendInvitations.localUserId, userId),
        eq(friendInvitations.direction, 'incoming'),
        eq(friendInvitations.status, 'pending'),
      ),
    )
    .limit(1)

  if (!invitation[0]) {
    return { success: false, error: 'Invitation not found' }
  }

  const inv = invitation[0]

  // Resolve sender to get their keys
  const sender = await resolveHandle(inv.fromHandle)
  if (!sender) {
    return { success: false, error: 'Could not resolve sender' }
  }

  // Get acceptor's handle
  const myHandle = await getUserHandle(userId)
  if (!myHandle) {
    return {
      success: false,
      error: 'You must set an alias before accepting invitations',
    }
  }

  // Delete the incoming invitation (no longer needed)
  await db
    .delete(friendInvitations)
    .where(eq(friendInvitations.id, invitationId))

  // Create friendship record
  await db.insert(friendships).values({
    id: generateId(),
    userId,
    friendHandle: inv.fromHandle,
    friendSigningKey: sender.signingKey,
    friendEncryptionKey: sender.encryptionKey,
    status: 'accepted',
    establishedAt: new Date(),
  })

  // If sender is local, delete their invitation and create friendship
  if (isLocalHandle(inv.fromHandle)) {
    const parsed = parseHandle(inv.fromHandle)
    if (parsed) {
      const senderUser = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.alias, parsed.alias))
        .limit(1)

      if (senderUser[0]) {
        // Delete sender's outgoing invitation
        await db
          .delete(friendInvitations)
          .where(
            and(
              eq(friendInvitations.fromHandle, inv.fromHandle),
              eq(friendInvitations.toHandle, inv.toHandle),
              eq(friendInvitations.direction, 'outgoing'),
            ),
          )

        // Get acceptor's keys
        const acceptorInfo = await getUserIdentity(userId)

        // Create friendship for sender
        await db.insert(friendships).values({
          id: generateId(),
          userId: senderUser[0].id,
          friendHandle: myHandle,
          friendSigningKey: acceptorInfo?.signingKey || null,
          friendEncryptionKey: acceptorInfo?.encryptionKey || null,
          status: 'accepted',
          establishedAt: new Date(),
        })
      }
    }
  } else {
    // Send acceptance to remote server
    const timestamp = new Date().toISOString()
    const message: FederationMessage = {
      type: 'FRIEND_ACCEPT',
      from: myHandle,
      to: inv.fromHandle,
      timestamp,
      signature,
    }

    await sendFederationMessage(sender.inbox, message)
  }

  // Tell both sides the friendship now exists. Partner may be local (we
  // looked them up above) or remote (federation).
  await emit.friendship(
    'friendship:created',
    { fromHandle: inv.fromHandle, toHandle: myHandle },
    userId,
    { handle: inv.fromHandle },
  )

  return { success: true }
}

/**
 * Reject a friend invitation
 */
export async function rejectFriendInvitation(
  userId: string,
  invitationId: string,
  signature?: string,
): Promise<{ success: boolean; error?: string }> {
  // Find the invitation
  const invitation = await db
    .select()
    .from(friendInvitations)
    .where(
      and(
        eq(friendInvitations.id, invitationId),
        eq(friendInvitations.localUserId, userId),
        eq(friendInvitations.direction, 'incoming'),
        eq(friendInvitations.status, 'pending'),
      ),
    )
    .limit(1)

  if (!invitation[0]) {
    return { success: false, error: 'Invitation not found' }
  }

  const inv = invitation[0]

  // Delete the invitation
  await db
    .delete(friendInvitations)
    .where(eq(friendInvitations.id, invitationId))

  // If sender is local, delete their invitation too
  if (isLocalHandle(inv.fromHandle)) {
    await db
      .delete(friendInvitations)
      .where(
        and(
          eq(friendInvitations.fromHandle, inv.fromHandle),
          eq(friendInvitations.toHandle, inv.toHandle),
          eq(friendInvitations.direction, 'outgoing'),
        ),
      )
  } else if (signature) {
    // Send rejection to remote server
    const myHandle = await getUserHandle(userId)
    if (myHandle) {
      const sender = await resolveHandle(inv.fromHandle)
      if (sender) {
        const message: FederationMessage = {
          type: 'FRIEND_REJECT',
          from: myHandle,
          to: inv.fromHandle,
          timestamp: new Date().toISOString(),
          signature,
        }
        await sendFederationMessage(sender.inbox, message)
      }
    }
  }

  await emit.friendship(
    'friend-invitation:rejected',
    { id: invitationId, fromHandle: inv.fromHandle, toHandle: inv.toHandle },
    userId,
    { handle: inv.fromHandle },
  )

  return { success: true }
}

/**
 * Cancel an outgoing invitation
 */
export async function cancelFriendInvitation(
  userId: string,
  invitationId: string,
): Promise<{ success: boolean; error?: string }> {
  const invitation = await db
    .select()
    .from(friendInvitations)
    .where(
      and(
        eq(friendInvitations.id, invitationId),
        eq(friendInvitations.localUserId, userId),
        eq(friendInvitations.direction, 'outgoing'),
        eq(friendInvitations.status, 'pending'),
      ),
    )
    .limit(1)

  if (!invitation[0]) {
    return { success: false, error: 'Invitation not found' }
  }

  const inv = invitation[0]

  // Delete the outgoing invitation
  await db
    .delete(friendInvitations)
    .where(eq(friendInvitations.id, invitationId))

  // If recipient is local, delete their incoming invitation too
  if (isLocalHandle(inv.toHandle)) {
    await db
      .delete(friendInvitations)
      .where(
        and(
          eq(friendInvitations.fromHandle, inv.fromHandle),
          eq(friendInvitations.toHandle, inv.toHandle),
          eq(friendInvitations.direction, 'incoming'),
        ),
      )
  }

  await emit.friendship(
    'friend-invitation:cancelled',
    { id: invitationId, fromHandle: inv.fromHandle, toHandle: inv.toHandle },
    userId,
    { handle: inv.toHandle },
  )

  return { success: true }
}

/**
 * Get all friends for a user
 * For local friends, we join with the users table to get fresh name/picture.
 * For remote friends, we use the cached values (refreshed via /sync-keys).
 */
export async function getFriends(userId: string): Promise<Friendship[]> {
  const serverDomain = getServerDomain()

  // Get all friendships
  const allFriendships = await db
    .select()
    .from(friendships)
    .where(
      and(eq(friendships.userId, userId), eq(friendships.status, 'accepted')),
    )

  // For local friends, fetch fresh user data
  const result: Friendship[] = []

  for (const friendship of allFriendships) {
    const parsed = parseHandle(friendship.friendHandle)

    // For local friends, refresh name + picture straight from the users
    // table — both are cleartext now (see SECURITY.md).
    if (parsed && parsed.domain === serverDomain) {
      const [localUser] = await db
        .select({
          firstName: users.firstName,
          lastName: users.lastName,
          picture: users.picture,
        })
        .from(users)
        .where(eq(users.alias, parsed.alias))
        .limit(1)

      if (localUser) {
        const displayName =
          localUser.firstName && localUser.lastName
            ? `${localUser.firstName} ${localUser.lastName}`
            : localUser.firstName || parsed.alias

        result.push({
          ...friendship,
          friendName: displayName,
          friendPicture: localUser.picture,
        })
        continue
      }
    }

    result.push(friendship)
  }

  return result
}

/**
 * Get pending invitations for a user
 */
export async function getInvitations(
  userId: string,
  direction?: InvitationDirection,
): Promise<FriendInvitation[]> {
  const conditions = [
    eq(friendInvitations.localUserId, userId),
    eq(friendInvitations.status, 'pending'),
  ]

  if (direction) {
    conditions.push(eq(friendInvitations.direction, direction))
  }

  return db
    .select()
    .from(friendInvitations)
    .where(and(...conditions))
}

/**
 * Remove a friend (bidirectional)
 * When user A removes user B:
 * - Both sides' friendship records are deleted.
 * - Location-sharing state is torn down on both ends.
 * - If the friend is remote, a signed RELATIONSHIP_REVOKE message is sent to
 *   their home server so it can drop cached keys, pins, and any queued state.
 *
 * @param revokeSignature - Client-produced Ed25519 signature over the v2
 *   revoke envelope. Required for remote revocations so the peer can verify
 *   user intent independently of the home server.
 */
export async function removeFriend(
  userId: string,
  friendHandle: string,
  revokeSignature?: string,
): Promise<{ success: boolean; error?: string }> {
  const friendship = await db
    .select()
    .from(friendships)
    .where(
      and(
        eq(friendships.userId, userId),
        eq(friendships.friendHandle, friendHandle),
      ),
    )
    .limit(1)

  if (!friendship[0]) {
    return { success: false, error: 'Friendship not found' }
  }

  const myHandle = await getUserHandle(userId)

  await db.delete(friendships).where(eq(friendships.id, friendship[0].id))

  if (myHandle && isLocalHandle(friendHandle)) {
    const parsed = parseHandle(friendHandle)
    if (parsed) {
      const friendUser = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.alias, parsed.alias))
        .limit(1)

      if (friendUser[0]) {
        await db
          .delete(friendships)
          .where(
            and(
              eq(friendships.userId, friendUser[0].id),
              eq(friendships.friendHandle, myHandle),
            ),
          )

        await cleanupLocationSharingForFriend(friendUser[0].id, myHandle)
      }
    }
  } else if (myHandle && !isLocalHandle(friendHandle) && revokeSignature) {
    // Remote friend: propagate revocation to their home server.
    const { generateNonce, nowIso } = await import('../lib/federation-canonical')
    const { getProtocolVersion } = await import('../lib/server-identity')
    const revokeMessage: FederationMessage = {
      protocol_version: getProtocolVersion(),
      message_type: 'RELATIONSHIP_REVOKE',
      message_version: 1,
      nonce: generateNonce(),
      timestamp: nowIso(),
      from: myHandle,
      to: friendHandle,
      signature: revokeSignature,
      payload: {},
    }
    await sendFederationMessage(friendHandle, revokeMessage)
  }

  await cleanupLocationSharingForFriend(userId, friendHandle)

  await emit.friendship(
    'friendship:removed',
    { userId, friendHandle },
    userId,
    { handle: friendHandle },
  )

  return { success: true }
}

/**
 * Handle an inbound RELATIONSHIP_REVOKE from a remote peer.
 * Tears down the local side of the friendship and all location-sharing state.
 */
export async function handleIncomingRelationshipRevoke(
  fromHandle: string,
  toHandle: string,
): Promise<{ success: boolean; error?: string }> {
  const parsed = parseHandle(toHandle)
  if (!parsed) {
    return { success: false, error: 'Invalid recipient handle' }
  }

  const localUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.alias, parsed.alias))
    .limit(1)

  if (!localUser[0]) {
    // Nothing to revoke on our side.
    return { success: true }
  }

  await db
    .delete(friendships)
    .where(
      and(
        eq(friendships.userId, localUser[0].id),
        eq(friendships.friendHandle, fromHandle),
      ),
    )

  // Drop any pending invitations between these handles too.
  await db
    .delete(friendInvitations)
    .where(
      and(
        eq(friendInvitations.fromHandle, fromHandle),
        eq(friendInvitations.toHandle, toHandle),
      ),
    )

  await cleanupLocationSharingForFriend(localUser[0].id, fromHandle)

  return { success: true }
}

/**
 * Helper to clean up all location sharing data for a friend relationship
 */
async function cleanupLocationSharingForFriend(
  userId: string,
  friendHandle: string,
): Promise<void> {
  // Import here to avoid circular dependency
  const { disableLocationSharing } = await import('./location-e2ee.service')

  try {
    await disableLocationSharing(userId, friendHandle)
  } catch {
    // Silently ignore if no config exists
  }
}

/**
 * Update a friend's cached public keys
 * Used when keys are refreshed from the remote server
 */
export async function updateFriendKeys(
  userId: string,
  friendHandle: string,
  data: {
    signingKey?: string | null
    encryptionKey?: string | null
    name?: string | null
    picture?: string | null
  },
): Promise<boolean> {
  const result = await db
    .update(friendships)
    .set({
      friendSigningKey: data.signingKey,
      friendEncryptionKey: data.encryptionKey,
      friendName: data.name,
      friendPicture: data.picture,
    })
    .where(
      and(
        eq(friendships.userId, userId),
        eq(friendships.friendHandle, friendHandle),
      ),
    )
    .returning()

  return result.length > 0
}

/**
 * Sync friend keys and profile info from their servers
 * Resolves each friend's current public keys and profile, updating if changed
 */
export async function syncFriendKeys(
  userId: string,
): Promise<Array<{ handle: string; updated: boolean; error?: string }>> {
  const friends = await getFriends(userId)
  const results: Array<{ handle: string; updated: boolean; error?: string }> =
    []

  for (const friend of friends) {
    try {
      // Resolve the friend's current public keys and profile
      const userInfo = await resolveHandle(friend.friendHandle)

      if (!userInfo) {
        results.push({
          handle: friend.friendHandle,
          updated: false,
          error: 'User not found',
        })
        continue
      }

      // Check if anything has changed (keys or profile)
      const keysChanged =
        userInfo.signingKey !== friend.friendSigningKey ||
        userInfo.encryptionKey !== friend.friendEncryptionKey

      const profileChanged =
        userInfo.name !== friend.friendName ||
        userInfo.picture !== friend.friendPicture

      if (keysChanged || profileChanged) {
        await updateFriendKeys(userId, friend.friendHandle, {
          signingKey: userInfo.signingKey,
          encryptionKey: userInfo.encryptionKey,
          name: userInfo.name,
          picture: userInfo.picture,
        })
        results.push({ handle: friend.friendHandle, updated: true })
      } else {
        results.push({ handle: friend.friendHandle, updated: false })
      }
    } catch (err) {
      results.push({
        handle: friend.friendHandle,
        updated: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return results
}

// ============================================================================
// Federation Handlers - Called by federation.service when receiving messages
// ============================================================================

/**
 * Handle incoming friend invitation from a remote server
 */
export async function handleIncomingFriendInvite(
  fromHandle: string,
  toHandle: string,
  senderInfo: RemoteUserInfo,
  signature: string,
): Promise<{ success: boolean; error?: string }> {
  const parsed = parseHandle(toHandle)
  if (!parsed) return { success: false, error: 'Invalid recipient handle' }

  // Find local user
  const localUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.alias, parsed.alias))
    .limit(1)

  if (!localUser[0]) {
    return { success: false, error: 'Recipient not found' }
  }

  // Check for existing invitation from this sender to this recipient
  const existing = await db
    .select()
    .from(friendInvitations)
    .where(
      and(
        eq(friendInvitations.fromHandle, fromHandle),
        eq(friendInvitations.toHandle, toHandle),
      ),
    )
    .limit(1)

  if (existing[0] && existing[0].status === 'pending') {
    return { success: false, error: 'Invitation already exists' }
  }

  // Create incoming invitation
  await db.insert(friendInvitations).values({
    id: generateId(),
    fromHandle,
    toHandle,
    localUserId: localUser[0].id,
    direction: 'incoming',
    status: 'pending',
    originServer: parseHandle(fromHandle)?.domain || '',
    signature,
  })

  return { success: true }
}

/**
 * Handle friend acceptance from a remote server
 */
export async function handleIncomingFriendAccept(
  fromHandle: string,
  toHandle: string,
  senderInfo: RemoteUserInfo,
): Promise<{ success: boolean; error?: string }> {
  const parsed = parseHandle(toHandle)
  if (!parsed) return { success: false, error: 'Invalid recipient handle' }

  // Find the original outgoing invitation (from local user to the acceptor)
  const invitation = await db
    .select()
    .from(friendInvitations)
    .where(
      and(
        eq(friendInvitations.fromHandle, toHandle),
        eq(friendInvitations.toHandle, fromHandle),
      ),
    )
    .limit(1)

  if (!invitation[0]) {
    return { success: false, error: 'Original invitation not found' }
  }

  // Find local user
  const localUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.alias, parsed.alias))
    .limit(1)

  if (!localUser[0]) {
    return { success: false, error: 'Local user not found' }
  }

  // Delete the invitation (no longer needed)
  await db
    .delete(friendInvitations)
    .where(eq(friendInvitations.id, invitation[0].id))

  // Create friendship record
  await db.insert(friendships).values({
    id: generateId(),
    userId: localUser[0].id,
    friendHandle: fromHandle,
    friendSigningKey: senderInfo.signingKey,
    friendEncryptionKey: senderInfo.encryptionKey,
    friendName: senderInfo.name || null,
    friendPicture: senderInfo.picture || null,
    status: 'accepted',
    establishedAt: new Date(),
  })

  return { success: true }
}

/**
 * Handle friend rejection from a remote server
 */
export async function handleIncomingFriendReject(
  fromHandle: string,
): Promise<{ success: boolean; error?: string }> {
  // Find and delete the original invitation
  const invitation = await db
    .select()
    .from(friendInvitations)
    .where(eq(friendInvitations.toHandle, fromHandle))
    .limit(1)

  if (!invitation[0]) {
    return { success: false, error: 'Invitation not found' }
  }

  await db
    .delete(friendInvitations)
    .where(eq(friendInvitations.id, invitation[0].id))

  return { success: true }
}

/**
 * Check if a user is friends with the given handle
 */
export async function isFriend(
  userId: string,
  friendHandle: string,
): Promise<boolean> {
  const friendship = await db
    .select()
    .from(friendships)
    .where(
      and(
        eq(friendships.userId, userId),
        eq(friendships.friendHandle, friendHandle),
        eq(friendships.status, 'accepted'),
      ),
    )
    .limit(1)

  return !!friendship[0]
}
