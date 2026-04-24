import { db } from '../../db'
import { collections, bookmarksCollections } from '../../schema/library.schema'
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
