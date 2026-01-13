/**
 * Sharing Service
 *
 * Handles E2EE resource sharing between users (same-server and cross-server)
 */

import { and, eq, or } from 'drizzle-orm'
import { db } from '../db'
import {
  shares,
  incomingShares,
  Share,
  NewShare,
  IncomingShare,
  NewIncomingShare,
} from '../schema/shares.schema'
import { friendships } from '../schema/friendships.schema'
import { users } from '../schema/users.schema'
import { generateId } from '../util'
import {
  isLocalHandle,
  sendFederationMessage,
  buildHandle,
} from './federation.service'
import { parseHandle } from '../lib/crypto'

export type ResourceType = 'collection' | 'route' | 'map' | 'layer'

export interface CreateShareParams {
  userId: string
  recipientHandle: string
  resourceType: ResourceType
  resourceId: string
  encryptedData?: string
  nonce?: string
}

// ============================================================================
// Outgoing Shares (from local user)
// ============================================================================

/**
 * Create a share for a resource
 */
export async function createShare(params: CreateShareParams): Promise<Share> {
  // Check if recipient is local
  const isLocal = isLocalHandle(params.recipientHandle)
  let recipientUserId: string | null = null

  if (isLocal) {
    const parsed = parseHandle(params.recipientHandle)
    if (parsed) {
      const [localUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.alias, parsed.alias))
        .limit(1)
      recipientUserId = localUser?.id || null
    }
  }

  const newShare: NewShare = {
    id: generateId(),
    userId: params.userId,
    recipientHandle: params.recipientHandle,
    recipientUserId,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    encryptedData: params.encryptedData || null,
    nonce: params.nonce || null,
    status: 'pending',
  }

  const [share] = await db.insert(shares).values(newShare).returning()

  // If cross-server, send federation message
  if (!isLocal && params.encryptedData && params.nonce) {
    await sendShareToRemote(share)
  } else if (
    isLocal &&
    recipientUserId &&
    params.encryptedData &&
    params.nonce
  ) {
    // For local users, create incoming share directly
    await createIncomingShare({
      userId: recipientUserId,
      senderHandle: await getLocalUserHandle(params.userId),
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      encryptedData: params.encryptedData,
      nonce: params.nonce,
    })
  }

  return share
}

/**
 * Get all outgoing shares for a user
 */
export async function getOutgoingShares(userId: string): Promise<Share[]> {
  return await db.select().from(shares).where(eq(shares.userId, userId))
}

/**
 * Get shares for a specific resource
 */
export async function getSharesForResource(
  userId: string,
  resourceType: ResourceType,
  resourceId: string,
): Promise<Share[]> {
  return await db
    .select()
    .from(shares)
    .where(
      and(
        eq(shares.userId, userId),
        eq(shares.resourceType, resourceType),
        eq(shares.resourceId, resourceId),
      ),
    )
}

/**
 * Revoke a share
 */
export async function revokeShare(
  userId: string,
  shareId: string,
): Promise<boolean> {
  const [updated] = await db
    .update(shares)
    .set({ status: 'revoked' })
    .where(and(eq(shares.id, shareId), eq(shares.userId, userId)))
    .returning()

  return !!updated
}

/**
 * Delete a share
 */
export async function deleteShare(
  userId: string,
  shareId: string,
): Promise<boolean> {
  const result = await db
    .delete(shares)
    .where(and(eq(shares.id, shareId), eq(shares.userId, userId)))
    .returning()

  return result.length > 0
}

// ============================================================================
// Incoming Shares (to local user)
// ============================================================================

interface CreateIncomingShareParams {
  userId: string
  senderHandle: string
  resourceType: string
  resourceId: string
  encryptedData: string
  nonce: string
  signature?: string
}

/**
 * Create an incoming share
 */
export async function createIncomingShare(
  params: CreateIncomingShareParams,
): Promise<IncomingShare> {
  const newIncoming: NewIncomingShare = {
    id: generateId(),
    userId: params.userId,
    senderHandle: params.senderHandle,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    encryptedData: params.encryptedData,
    nonce: params.nonce,
    signature: params.signature || null,
    status: 'pending',
  }

  const [incoming] = await db
    .insert(incomingShares)
    .values(newIncoming)
    .returning()
  return incoming
}

/**
 * Get all incoming shares for a user
 */
export async function getIncomingShares(
  userId: string,
): Promise<IncomingShare[]> {
  return await db
    .select()
    .from(incomingShares)
    .where(eq(incomingShares.userId, userId))
}

/**
 * Get pending incoming shares
 */
export async function getPendingIncomingShares(
  userId: string,
): Promise<IncomingShare[]> {
  return await db
    .select()
    .from(incomingShares)
    .where(
      and(
        eq(incomingShares.userId, userId),
        eq(incomingShares.status, 'pending'),
      ),
    )
}

/**
 * Accept an incoming share
 */
export async function acceptIncomingShare(
  userId: string,
  shareId: string,
): Promise<IncomingShare | null> {
  const [updated] = await db
    .update(incomingShares)
    .set({
      status: 'accepted',
      acceptedAt: new Date(),
    })
    .where(
      and(eq(incomingShares.id, shareId), eq(incomingShares.userId, userId)),
    )
    .returning()

  return updated || null
}

/**
 * Reject an incoming share
 */
export async function rejectIncomingShare(
  userId: string,
  shareId: string,
): Promise<boolean> {
  const [updated] = await db
    .update(incomingShares)
    .set({ status: 'rejected' })
    .where(
      and(eq(incomingShares.id, shareId), eq(incomingShares.userId, userId)),
    )
    .returning()

  return !!updated
}

/**
 * Delete an incoming share
 */
export async function deleteIncomingShare(
  userId: string,
  shareId: string,
): Promise<boolean> {
  const result = await db
    .delete(incomingShares)
    .where(
      and(eq(incomingShares.id, shareId), eq(incomingShares.userId, userId)),
    )
    .returning()

  return result.length > 0
}

// ============================================================================
// Federation Helpers
// ============================================================================

/**
 * Send share to remote server
 */
async function sendShareToRemote(share: Share): Promise<boolean> {
  try {
    const senderHandle = await getLocalUserHandle(share.userId)

    await sendFederationMessage(share.recipientHandle, {
      type: 'RESOURCE_SHARE',
      from: senderHandle,
      to: share.recipientHandle,
      timestamp: new Date().toISOString(),
      signature: '', // TODO: Sign the message
      resourceType: share.resourceType,
      resourceId: share.resourceId,
      encryptedData: share.encryptedData || undefined,
      nonce: share.nonce || undefined,
    })

    return true
  } catch (error) {
    console.error('Failed to send share to remote:', error)
    return false
  }
}

/**
 * Get local user's handle
 */
async function getLocalUserHandle(userId: string): Promise<string> {
  const [user] = await db
    .select({ alias: users.alias })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user?.alias) {
    throw new Error('User has no alias')
  }

  return buildHandle(user.alias)
}

/**
 * Verify share is from a friend
 */
export async function verifyShareFromFriend(
  userId: string,
  senderHandle: string,
): Promise<boolean> {
  const [friendship] = await db
    .select()
    .from(friendships)
    .where(
      and(
        eq(friendships.userId, userId),
        eq(friendships.friendHandle, senderHandle),
        eq(friendships.status, 'accepted'),
      ),
    )
    .limit(1)

  return !!friendship
}

// ============================================================================
// Federation Handlers - Called by federation.service when receiving messages
// ============================================================================

/**
 * Handle incoming resource share from a remote friend
 */
export async function handleIncomingResourceShare(
  senderHandle: string,
  recipientAlias: string,
  resourceType: string,
  resourceId: string,
  encryptedData: string,
  nonce: string,
  signature: string,
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

  await createIncomingShare({
    userId: localUserId,
    senderHandle: senderHandle,
    resourceType: resourceType as ResourceType,
    resourceId: resourceId,
    encryptedData: encryptedData,
    nonce: nonce,
    signature: signature,
  })

  return { success: true }
}
