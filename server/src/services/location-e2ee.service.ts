/**
 * Location E2EE Service
 *
 * Handles encrypted location sharing with friends via federation handles.
 * All location data is end-to-end encrypted - the server only stores ciphertext.
 */

import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import {
  locationSharingConfig,
  encryptedLocations,
  LocationSharingConfig,
  NewLocationSharingConfig,
  EncryptedLocation,
  NewEncryptedLocation,
} from '../schema/location.schema'
import { friendships } from '../schema/friendships.schema'
import { generateId } from '../util'
import { buildHandle, sendFederationMessage } from './federation.service'
import { emit } from './realtime/emit'
import { users } from '../schema/users.schema'
import { logger } from '../lib/logger'

// ============================================================================
// Location Sharing Configuration
// ============================================================================

/**
 * Get all location sharing configs for a user
 */
export async function getLocationSharingConfigs(
  userId: string,
): Promise<LocationSharingConfig[]> {
  return await db
    .select()
    .from(locationSharingConfig)
    .where(eq(locationSharingConfig.userId, userId))
}

/**
 * Get location sharing config for a specific friend
 */
export async function getLocationSharingConfigForFriend(
  userId: string,
  friendHandle: string,
): Promise<LocationSharingConfig | null> {
  const [config] = await db
    .select()
    .from(locationSharingConfig)
    .where(
      and(
        eq(locationSharingConfig.userId, userId),
        eq(locationSharingConfig.friendHandle, friendHandle),
      ),
    )
    .limit(1)

  return config || null
}

/**
 * Enable or update location sharing with a friend.
 *
 * NOTE: the schema still has `refresh_interval` and `expires_at` columns
 * for backward compat; both are unused by code (real-time push replaced
 * polling, and expiry was never enforced). New rows use the column
 * defaults.
 */
export async function setLocationSharingConfig(
  userId: string,
  friendHandle: string,
  config: { enabled?: boolean },
): Promise<LocationSharingConfig> {
  const existing = await getLocationSharingConfigForFriend(userId, friendHandle)

  if (existing) {
    const [updated] = await db
      .update(locationSharingConfig)
      .set({
        enabled: config.enabled ?? existing.enabled,
        updatedAt: new Date(),
      })
      .where(eq(locationSharingConfig.id, existing.id))
      .returning()

    return updated
  }

  const newConfig: NewLocationSharingConfig = {
    id: generateId(),
    userId,
    friendHandle,
    enabled: config.enabled ?? true,
  }

  const [created] = await db
    .insert(locationSharingConfig)
    .values(newConfig)
    .returning()

  return created
}

/**
 * Disable location sharing with a friend.
 *
 * Deletes the sharing config AND the cached ciphertext row, then emits a
 * `location:cleared` event to the recipient so their UI evicts the marker
 * immediately (otherwise the last-known position lingers until the next
 * refetch). Failure to emit must not break the disable; the recipient
 * will still drop the entry on their next `realtime:reconnected` refetch.
 */
export async function disableLocationSharing(
  userId: string,
  friendHandle: string,
): Promise<boolean> {
  const result = await db
    .delete(locationSharingConfig)
    .where(
      and(
        eq(locationSharingConfig.userId, userId),
        eq(locationSharingConfig.friendHandle, friendHandle),
      ),
    )
    .returning()

  // Also delete cached encrypted location
  await db
    .delete(encryptedLocations)
    .where(
      and(
        eq(encryptedLocations.userId, userId),
        eq(encryptedLocations.forFriendHandle, friendHandle),
      ),
    )

  // Tell the recipient to drop the marker. Best-effort; if the lookup or
  // emit fails the row is still gone and the next reconnect refetch will
  // converge state.
  void publishLocationCleared(userId, friendHandle).catch((err) => {
    logger.error(
      { err, userId, friendHandle },
      'Failed to publish location:cleared realtime event',
    )
  })

  return result.length > 0
}

async function publishLocationCleared(
  senderUserId: string,
  recipientHandle: string,
): Promise<void> {
  const [sender] = await db
    .select({ alias: users.alias })
    .from(users)
    .where(eq(users.id, senderUserId))
    .limit(1)
  if (!sender?.alias) return

  await emit.encryptedLocation(
    'location:cleared',
    { senderHandle: buildHandle(sender.alias) },
    recipientHandle,
  )
}

// ============================================================================
// Encrypted Location Cache (for live sharing)
// ============================================================================

/**
 * Result of an attempted store. `replayed` means the incoming nonce was
 * not strictly newer than the existing row's — we drop the write and
 * keep the existing row to defeat replay attacks (federation messages
 * can be re-sent by an attacker who captured them).
 */
export type StoreEncryptedLocationResult =
  | { stored: true; row: EncryptedLocation }
  | { stored: false; replayed: true; row: EncryptedLocation }

/**
 * Store encrypted location for a friend. Called when a user broadcasts.
 *
 * Authorization is the caller's responsibility — both the local POST
 * controller and the federation receive handler must verify friendship
 * before invoking this.
 *
 * Replay protection: the v2 `nonce` carries the sender's RFC 3339
 * timestamp. We refuse to overwrite a stored row with an equal-or-older
 * nonce. Without this guard a captured ciphertext could be replayed to
 * roll the recipient's view back in time.
 */
export async function storeEncryptedLocation(
  userId: string,
  forFriendHandle: string,
  encryptedLocation: string,
  nonce: string,
): Promise<StoreEncryptedLocationResult> {
  const existing = await db
    .select()
    .from(encryptedLocations)
    .where(
      and(
        eq(encryptedLocations.userId, userId),
        eq(encryptedLocations.forFriendHandle, forFriendHandle),
      ),
    )
    .limit(1)

  let row: EncryptedLocation
  if (existing.length > 0) {
    if (!isNonceNewer(nonce, existing[0].nonce)) {
      return { stored: false, replayed: true, row: existing[0] }
    }
    const [updated] = await db
      .update(encryptedLocations)
      .set({ encryptedLocation, nonce, updatedAt: new Date() })
      .where(eq(encryptedLocations.id, existing[0].id))
      .returning()
    row = updated
  } else {
    const newLocation: NewEncryptedLocation = {
      id: generateId(),
      userId,
      forFriendHandle,
      encryptedLocation,
      nonce,
    }
    const [created] = await db
      .insert(encryptedLocations)
      .values(newLocation)
      .returning()
    row = created
  }

  // Push to recipient via realtime (fire-and-forget; failure must not
  // break the broadcast). Sender handle is built from their alias so the
  // client can match the row to the friend record.
  void publishLocationUpdate(row).catch((err) => {
    logger.error(
      { err, eventLocationId: row.id },
      'Failed to publish location:updated realtime event',
    )
  })

  return { stored: true, row }
}

/**
 * Compare two RFC 3339 timestamps. Returns true iff `incoming` is
 * strictly newer than `existing`. Falls back to string compare if either
 * fails to parse — RFC 3339 sorts lexicographically, so this is sound for
 * well-formed timestamps and conservative (refuses) for malformed ones.
 */
function isNonceNewer(incoming: string, existing: string): boolean {
  const a = Date.parse(incoming)
  const b = Date.parse(existing)
  if (Number.isFinite(a) && Number.isFinite(b)) return a > b
  return incoming > existing
}

async function publishLocationUpdate(row: EncryptedLocation): Promise<void> {
  const [sender] = await db
    .select({ alias: users.alias })
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1)
  if (!sender?.alias) return

  await emit.encryptedLocation(
    'location:updated',
    {
      id: row.id,
      fromUserId: row.userId,
      senderHandle: buildHandle(sender.alias),
      encryptedLocation: row.encryptedLocation,
      nonce: row.nonce,
      updatedAt: row.updatedAt.toISOString(),
    },
    row.forFriendHandle,
  )
}

/**
 * Get encrypted location that a user has stored for a specific friend
 * (Used when friend requests location)
 */
export async function getEncryptedLocationForFriend(
  userId: string,
  forFriendHandle: string,
): Promise<EncryptedLocation | null> {
  const [location] = await db
    .select()
    .from(encryptedLocations)
    .where(
      and(
        eq(encryptedLocations.userId, userId),
        eq(encryptedLocations.forFriendHandle, forFriendHandle),
      ),
    )
    .limit(1)

  return location || null
}

/**
 * Result type for friend locations with sender info
 */
export interface FriendEncryptedLocation extends EncryptedLocation {
  senderHandle: string | null
}

/**
 * Get all encrypted locations sent TO this user — but only by users who
 * are still accepted friends. Filtering by friendship at read time is
 * defense-in-depth: even if a stale or maliciously-planted ciphertext
 * row existed for a non-friend handle, this won't surface it to the
 * client.
 */
export async function getEncryptedLocationsFromFriends(
  userId: string,
): Promise<FriendEncryptedLocation[]> {
  const [user] = await db
    .select({ alias: users.alias })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user?.alias) return []

  const userHandle = buildHandle(user.alias)

  const [friendHandles, results] = await Promise.all([
    // This user's accepted friendships — handles only.
    db
      .select({ handle: friendships.friendHandle })
      .from(friendships)
      .where(
        and(
          eq(friendships.userId, userId),
          eq(friendships.status, 'accepted'),
        ),
      ),
    // Encrypted-location rows targeted at this user, joined with the
    // sender so we can build their handle.
    db
      .select({
        id: encryptedLocations.id,
        userId: encryptedLocations.userId,
        forFriendHandle: encryptedLocations.forFriendHandle,
        encryptedLocation: encryptedLocations.encryptedLocation,
        nonce: encryptedLocations.nonce,
        updatedAt: encryptedLocations.updatedAt,
        senderAlias: users.alias,
      })
      .from(encryptedLocations)
      .leftJoin(users, eq(users.id, encryptedLocations.userId))
      .where(eq(encryptedLocations.forFriendHandle, userHandle)),
  ])

  const friendSet = new Set(friendHandles.map((f) => f.handle.toLowerCase()))

  return results
    .filter((r) =>
      r.senderAlias
        ? friendSet.has(buildHandle(r.senderAlias).toLowerCase())
        : false,
    )
    .map((r) => ({
      id: r.id,
      userId: r.userId,
      forFriendHandle: r.forFriendHandle,
      encryptedLocation: r.encryptedLocation,
      nonce: r.nonce,
      updatedAt: r.updatedAt,
      senderHandle: r.senderAlias ? buildHandle(r.senderAlias) : null,
    }))
}

// ============================================================================
// Federation helpers
// ============================================================================

/**
 * Send location update to a friend's server
 */
export async function sendLocationUpdateToFriend(
  fromHandle: string,
  toHandle: string,
  encryptedLocation: string,
  nonce: string,
  signature: string,
): Promise<boolean> {
  try {
    await sendFederationMessage(toHandle, {
      type: 'LOCATION_UPDATE',
      from: fromHandle,
      to: toHandle,
      encryptedLocation,
      nonce,
      timestamp: new Date().toISOString(),
      signature,
    })
    return true
  } catch (error) {
    logger.error({ err: error, fromHandle, toHandle }, 'Failed to send location update')
    return false
  }
}

/**
 * Request fresh location from a friend's server
 */
export async function requestLocationFromFriend(
  fromHandle: string,
  toHandle: string,
  signature: string,
): Promise<boolean> {
  try {
    await sendFederationMessage(toHandle, {
      type: 'LOCATION_REQUEST',
      from: fromHandle,
      to: toHandle,
      timestamp: new Date().toISOString(),
      signature,
    })
    return true
  } catch (error) {
    logger.error({ err: error, fromHandle, toHandle }, 'Failed to request location')
    return false
  }
}

// ============================================================================
// Federation Handlers - Called by federation.service when receiving messages
// ============================================================================

/**
 * Handle incoming location update from a remote friend
 */
export async function handleIncomingLocationUpdate(
  senderHandle: string,
  recipientAlias: string,
  encryptedLocation: string,
  nonce: string,
): Promise<{ success: boolean; error?: string }> {
  const { getLocalUserIdByAlias } = await import('./user.service')
  const { isFriend } = await import('./friends.service')

  const localUserId = await getLocalUserIdByAlias(recipientAlias)
  if (!localUserId) {
    return { success: false, error: 'Recipient not found' }
  }

  const areFriends = await isFriend(localUserId, senderHandle)
  if (!areFriends) {
    return { success: false, error: 'Not a friend' }
  }

  const result = await storeEncryptedLocation(
    localUserId,
    senderHandle,
    encryptedLocation,
    nonce,
  )
  if (!result.stored) {
    return { success: false, error: 'Replayed nonce' }
  }
  return { success: true }
}

/**
 * Handle incoming location request from a remote friend
 */
export async function handleIncomingLocationRequest(
  senderHandle: string,
  recipientAlias: string,
): Promise<{ success: boolean; error?: string }> {
  const { getLocalUserIdByAlias } = await import('./user.service')

  const localUserId = await getLocalUserIdByAlias(recipientAlias)
  if (!localUserId) {
    return { success: false, error: 'User not found' }
  }

  const config = await getLocationSharingConfigForFriend(
    localUserId,
    senderHandle,
  )
  if (!config || !config.enabled) {
    return { success: false, error: 'Location sharing not enabled' }
  }

  // Note: The actual location response happens via client polling, not server push
  return { success: true }
}
