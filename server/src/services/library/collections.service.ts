import { db } from '../../db'
import {
  collections,
  bookmarksCollections,
  encryptedPoints,
} from '../../schema/library.schema'
import { shares, incomingShares } from '../../schema/shares.schema'
import { and, eq, count, sql } from 'drizzle-orm'
import {
  CreateCollectionParams,
  NewCollection,
  NewBookmarkCollection,
  Collection,
} from '../../types/library.types'
import { generateId } from '../../util'
import { getBookmarkById } from './bookmarks.service'
import { bookmarks as bookmarksSchema } from '../../schema/library.schema'
import { inArray } from 'drizzle-orm'
import { unbookmark } from './bookmarks.service'
import { createSelectFieldsWithGeometry } from '../../util/geometry-conversion'
import { randomBytes } from 'node:crypto'

// Automatically generate bookmark select fields - no manual field listing needed!
const bookmarkSelectFields = createSelectFieldsWithGeometry(bookmarksSchema)

export async function getCollections(userId: string) {
  await ensureDefaultCollection(userId)

  return await db
    .select()
    .from(collections)
    .where(eq(collections.userId, userId))
}

export async function getCollectionById(id: string, userId: string) {
  return (
    await db
      .select()
      .from(collections)
      .where(and(eq(collections.id, id), eq(collections.userId, userId)))
  )[0]
}

export async function getDefaultCollection(userId: string) {
  return (
    await db
      .select()
      .from(collections)
      .where(
        and(eq(collections.userId, userId), eq(collections.isDefault, true)),
      )
  )[0]
}

export async function ensureDefaultCollection(userId: string) {
  const existingDefault = await getDefaultCollection(userId)
  if (existingDefault) {
    return existingDefault
  }

  // Default collection is created with no encrypted metadata — the client
  // writes an envelope via `updateCollection` the first time it loads the
  // user's library and sees the `isDefault` row without metadata. This
  // avoids the server needing any plaintext knowledge of display strings.
  const newCollection: NewCollection = {
    id: generateId(),
    isPublic: false,
    isDefault: true,
    userId: userId,
  }

  const [inserted] = await db
    .insert(collections)
    .values(newCollection)
    .returning()

  return inserted
}

export async function createCollection(params: CreateCollectionParams) {
  const newCollection: NewCollection = {
    id: generateId(),
    metadataEncrypted: params.metadataEncrypted,
    metadataKeyVersion: params.metadataKeyVersion ?? 1,
    isPublic: params.isPublic || false,
    isDefault: false, // Ensure new collections are not default
    userId: params.userId,
  }

  const [inserted] = await db
    .insert(collections)
    .values(newCollection)
    .returning()
  return inserted
}

export async function updateCollection(
  id: string,
  userId: string,
  updates: Partial<Collection>,
) {
  const { userId: _, id: __, ...validUpdates } = updates

  const [updatedCollection] = await db
    .update(collections)
    .set({
      ...validUpdates,
      updatedAt: new Date(),
    })
    .where(and(eq(collections.id, id), eq(collections.userId, userId)))
    .returning()

  return updatedCollection
}

export async function deleteCollection(id: string, userId: string) {
  const collection = await getCollectionById(id, userId)
  if (collection && collection.isDefault) {
    throw new Error('Cannot delete the default collection')
  }

  await db
    .delete(bookmarksCollections)
    .where(eq(bookmarksCollections.collectionId, id))

  const [deleted] = await db
    .delete(collections)
    .where(and(eq(collections.id, id), eq(collections.userId, userId)))
    .returning()

  if (deleted) {
    await db
      .update(collections)
      .set({ updatedAt: new Date() })
      .where(eq(collections.id, id))
  }

  return deleted
}

// ===== Bookmarks in Collections =====

export async function getBookmarksInCollection(
  collectionId: string,
  userId: string,
) {
  const collection = await getCollectionById(collectionId, userId)
  if (!collection) {
    return []
  }

  const bookmarkLinks = await db
    .select({ bookmarkId: bookmarksCollections.bookmarkId })
    .from(bookmarksCollections)
    .where(eq(bookmarksCollections.collectionId, collectionId))

  if (bookmarkLinks.length === 0) {
    return []
  }

  const bookmarkIds = bookmarkLinks.map((link) => link.bookmarkId)

  const bookmarks = await db
    .select(bookmarkSelectFields)
    .from(bookmarksSchema)
    .where(
      and(
        inArray(bookmarksSchema.id, bookmarkIds),
        eq(bookmarksSchema.userId, userId),
      ),
    )

  return bookmarks
}

// ===== Collection key rotation (revoke-on-e2ee) =====

/**
 * Payload the owner's client sends after building the new rotation locally.
 *
 * `metadataKeyVersion` is the NEW version (typically old + 1). Every
 * ciphertext (collection metadata + all encrypted points + every remaining
 * friend-share envelope) is already encrypted under the new key by the
 * owner's device. The server's only job is to atomically swap them in.
 *
 * `revokeRecipientHandles` are the handles whose shares must be deleted in
 * the same transaction — that's the actual "revoke" operation. Anyone not
 * listed gets their `shares.encryptedData` updated to the new rewrapped
 * value from `updatedShareEnvelopes`.
 */
export interface RotateCollectionKeyParams {
  collectionId: string
  userId: string
  newMetadataEncrypted: string
  newMetadataKeyVersion: number
  newEncryptedPoints: Array<{
    id?: string // reuse existing id when possible; mint a fresh one when null
    encryptedData: string
    nonce: string
  }>
  updatedShareEnvelopes: Array<{
    recipientHandle: string
    encryptedData: string
    nonce: string
  }>
  revokeRecipientHandles: string[]
}

/**
 * Thrown when the caller's metadataKeyVersion doesn't move forward (would
 * cause rotation to silently no-op). Controllers map this to 400.
 */
export class RotationVersionError extends Error {
  constructor(current: number, proposed: number) {
    super(
      `New metadataKeyVersion ${proposed} must be greater than current ${current}`,
    )
    this.name = 'RotationVersionError'
  }
}

/**
 * Apply a complete collection-key rotation in a single transaction.
 *
 * Every write (metadata, points, share envelopes, revoked shares) is staged
 * by the client under the NEW key before calling this endpoint. The server
 * never sees plaintext and doesn't need to understand key derivation — it
 * just swaps ciphertext rows atomically so no caller ever observes a
 * half-rotated collection.
 *
 * Owner-only. No-op + null if the collection doesn't exist or isn't owned
 * by `userId`.
 */
export async function rotateCollectionKey(
  params: RotateCollectionKeyParams,
): Promise<Collection | null> {
  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(collections)
      .where(
        and(
          eq(collections.id, params.collectionId),
          eq(collections.userId, params.userId),
        ),
      )
      .limit(1)
    if (!current) return null

    if (params.newMetadataKeyVersion <= current.metadataKeyVersion) {
      throw new RotationVersionError(
        current.metadataKeyVersion,
        params.newMetadataKeyVersion,
      )
    }

    // 1. Swap the collection metadata envelope + version. Also clears any
    //    public-link token — public links are only valid on server-key
    //    collections, and a rotation usually accompanies a scheme or
    //    membership change where the old token's trust context no longer
    //    applies.
    const [updatedCollection] = await tx
      .update(collections)
      .set({
        metadataEncrypted: params.newMetadataEncrypted,
        metadataKeyVersion: params.newMetadataKeyVersion,
        publicToken: null,
        publicRole: null,
        updatedAt: new Date(),
      })
      .where(eq(collections.id, params.collectionId))
      .returning()

    // 2. Re-seed the encrypted_points table with the new ciphertexts.
    //    Simplest correct sequence: delete all, reinsert. The client
    //    supplies new ids (or we mint).
    await tx
      .delete(encryptedPoints)
      .where(eq(encryptedPoints.collectionId, params.collectionId))

    if (params.newEncryptedPoints.length > 0) {
      await tx.insert(encryptedPoints).values(
        params.newEncryptedPoints.map((p) => ({
          id: p.id ?? generateId(),
          collectionId: params.collectionId,
          userId: params.userId,
          encryptedData: p.encryptedData,
          nonce: p.nonce,
        })),
      )
    }

    // 3. Update each remaining share's outbound envelope (rewrapped key).
    for (const env of params.updatedShareEnvelopes) {
      await tx
        .update(shares)
        .set({
          encryptedData: env.encryptedData,
          nonce: env.nonce,
        })
        .where(
          and(
            eq(shares.userId, params.userId),
            eq(shares.resourceType, 'collection'),
            eq(shares.resourceId, params.collectionId),
            eq(shares.recipientHandle, env.recipientHandle),
          ),
        )

      // Mirror on same-server recipients' incoming_shares.
      await tx
        .update(incomingShares)
        .set({
          encryptedData: env.encryptedData,
          nonce: env.nonce,
        })
        .where(
          and(
            eq(incomingShares.resourceType, 'collection'),
            eq(incomingShares.resourceId, params.collectionId),
            eq(incomingShares.senderHandle, env.recipientHandle),
          ),
        )
    }

    // 4. Delete revoked shares entirely. Both outgoing (owner side) and
    //    incoming (recipient side) rows go in one sweep.
    for (const revoked of params.revokeRecipientHandles) {
      await tx
        .delete(shares)
        .where(
          and(
            eq(shares.userId, params.userId),
            eq(shares.resourceType, 'collection'),
            eq(shares.resourceId, params.collectionId),
            eq(shares.recipientHandle, revoked),
          ),
        )
      await tx
        .delete(incomingShares)
        .where(
          and(
            eq(incomingShares.resourceType, 'collection'),
            eq(incomingShares.resourceId, params.collectionId),
            eq(incomingShares.senderHandle, revoked),
          ),
        )
    }

    return updatedCollection ?? null
  })
}

// ===== Public Link Sharing =====

/**
 * Thrown when a public-link operation is attempted on a user-e2ee
 * collection. Controllers map this to 400.
 */
export class PublicLinkNotAllowedOnE2eeError extends Error {
  constructor() {
    super('Public links are only allowed on server-key collections')
    this.name = 'PublicLinkNotAllowedOnE2eeError'
  }
}

/**
 * Mint a public-link token on a collection. Owner-only, server-key only.
 *
 * If a token already exists, returns the existing one (idempotent). Use
 * `revokePublicLink` + `createPublicLink` to rotate.
 */
export async function createPublicLink(
  collectionId: string,
  userId: string,
): Promise<{ publicToken: string; publicRole: 'viewer' } | null> {
  const collection = await getCollectionById(collectionId, userId)
  if (!collection) return null
  if (collection.scheme !== 'server-key') {
    throw new PublicLinkNotAllowedOnE2eeError()
  }
  if (collection.publicToken) {
    return {
      publicToken: collection.publicToken,
      publicRole: 'viewer',
    }
  }

  // 32 random bytes → base64url (no padding). Plenty of entropy; unguessable.
  const token = randomBytes(32).toString('base64url')

  const [updated] = await db
    .update(collections)
    .set({
      publicToken: token,
      publicRole: 'viewer',
      updatedAt: new Date(),
    })
    .where(and(eq(collections.id, collectionId), eq(collections.userId, userId)))
    .returning()
  if (!updated) return null

  return { publicToken: token, publicRole: 'viewer' }
}

/**
 * Revoke the public-link token on a collection. Owner-only.
 *
 * After revoke, the old token resolves to 404. No rotation — revoke then
 * mint anew if a new token is needed.
 */
export async function revokePublicLink(
  collectionId: string,
  userId: string,
): Promise<boolean> {
  const [updated] = await db
    .update(collections)
    .set({
      publicToken: null,
      publicRole: null,
      updatedAt: new Date(),
    })
    .where(and(eq(collections.id, collectionId), eq(collections.userId, userId)))
    .returning()
  return !!updated
}

/**
 * Resolve a public-link token to its collection + bookmarks. Called by the
 * unauthenticated `GET /public/collections/:token` endpoint.
 *
 * Returns null when the token doesn't match (revoked, never existed, or
 * the collection switched to user-e2ee and had its token cleared). Caller
 * translates null to 404.
 */
export async function getPublicCollectionByToken(token: string) {
  const [collection] = await db
    .select()
    .from(collections)
    .where(eq(collections.publicToken, token))
    .limit(1)
  if (!collection) return null

  // Defense in depth — the scheme guard is also on the mint path, but if
  // a future migration flips scheme without clearing the token, we still
  // refuse to serve.
  if (collection.scheme !== 'server-key') return null

  const bookmarkLinks = await db
    .select({ bookmarkId: bookmarksCollections.bookmarkId })
    .from(bookmarksCollections)
    .where(eq(bookmarksCollections.collectionId, collection.id))

  const bookmarkIds = bookmarkLinks.map((link) => link.bookmarkId)
  const bookmarks = bookmarkIds.length
    ? await db
        .select(bookmarkSelectFields)
        .from(bookmarksSchema)
        .where(inArray(bookmarksSchema.id, bookmarkIds))
    : []

  return {
    collection,
    bookmarks,
  }
}
