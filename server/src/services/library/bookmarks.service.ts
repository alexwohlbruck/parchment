import { db } from '../../db'
import {
  bookmarks,
  collections,
  bookmarksCollections,
} from '../../schema/library.schema'
import { and, eq, desc, inArray, count, sql } from 'drizzle-orm'
import {
  CreateBookmarkParams,
  NewBookmark,
  Bookmark,
  BookmarkCollection,
  NewBookmarkCollection,
} from '../../types/library.types'
import { generateId } from '../../util'
import { getDefaultCollection } from './collections.service'
import {
  createSelectFieldsWithGeometry,
  createPointFromCoordinates,
} from '../../util/geometry-conversion'
import { createBookmarkSearchCondition } from '../../util/text-search.util'

// Automatically generate select fields with geometry conversion - no manual field listing needed!
const bookmarkSelectFields = createSelectFieldsWithGeometry(bookmarks)
const bookmarkReturningFields = bookmarkSelectFields

export async function getBookmarkById(id: string, userId: string) {
  const result = await db
    .select(bookmarkSelectFields)
    .from(bookmarks)
    .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, userId)))

  return result[0]
}

/**
 * Internal function to create a bookmark record.
 */
async function createBookmarkInternal(
  params: CreateBookmarkParams,
): Promise<Bookmark> {
  const [inserted] = await db
    .insert(bookmarks)
    .values({
      id: generateId(),
      externalIds: params.externalIds,
      name: params.name,
      address: params.address,
      geometry: createPointFromCoordinates(params.lat, params.lng),
      icon: params.icon || 'map-pin',
      iconColor: params.iconColor || '#F43F5E',
      presetType: params.presetType,
      userId: params.userId,
    })
    .returning(bookmarkReturningFields)

  return inserted as Bookmark
}

/**
 * Creates a bookmark and assigns it to specified collections.
 * If no collection IDs are provided, assigns to the default collection.
 */
export async function createBookmark(
  params: CreateBookmarkParams,
  collectionIds: string[] | undefined,
  userId: string,
): Promise<Bookmark> {
  const bookmark = await createBookmarkInternal(params)

  let targetCollectionIds = collectionIds

  // Ensure assignment to at least the default collection if none specified
  if (!targetCollectionIds || targetCollectionIds.length === 0) {
    const defaultCollection = await getDefaultCollection(userId)
    if (defaultCollection) {
      targetCollectionIds = [defaultCollection.id]
    } else {
      // Should ideally not happen if ensureDefaultCollection works
      console.error('Default collection not found for user:', userId)
      // Return the bookmark without assigning to a collection, or throw error?
      // For now, returning the bookmark as is.
      return bookmark
    }
  }

  // Add to specified collections
  const relations: NewBookmarkCollection[] = targetCollectionIds.map(
    (collectionId) => ({
      bookmarkId: bookmark.id,
      collectionId,
      addedAt: new Date(),
    }),
  )

  if (relations.length > 0) {
    await db.insert(bookmarksCollections).values(relations)
    // Update collection `updatedAt` timestamps
    await db
      .update(collections)
      .set({ updatedAt: new Date() })
      .where(inArray(collections.id, targetCollectionIds))
  }

  return bookmark
}

/**
 * Internal function to update a bookmark record.
 */
async function updateBookmarkInternal(
  id: string,
  userId: string,
  updates: Partial<Bookmark>,
): Promise<Bookmark | undefined> {
  const { externalIds, userId: _, id: __, lat, lng, ...validUpdates } = updates

  // If lat/lng are provided, convert to geometry
  const updateData: any = { ...validUpdates, updatedAt: new Date() }
  if (lat !== undefined && lng !== undefined) {
    updateData.geometry = createPointFromCoordinates(lat, lng)
  }

  const [updated] = await db
    .update(bookmarks)
    .set(updateData)
    .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, userId)))
    .returning(bookmarkReturningFields)

  return updated as Bookmark
}

/**
 * Updates a bookmark and optionally re-assigns its collections.
 */
export async function updateBookmark(
  bookmarkId: string,
  userId: string,
  updates: Partial<Bookmark> & { collectionIds?: string[] },
  _collectionIdsFromController?: string[] | undefined,
): Promise<Bookmark | null> {
  const { collectionIds, ...bookmarkUpdates } = updates

  const updatedBookmark = await updateBookmarkInternal(
    bookmarkId,
    userId,
    bookmarkUpdates,
  )

  if (!updatedBookmark) {
    return null
  }

  if (collectionIds !== undefined) {
    const currentCollectionIds = (
      await db
        .select({ collectionId: bookmarksCollections.collectionId })
        .from(bookmarksCollections)
        .where(eq(bookmarksCollections.bookmarkId, bookmarkId))
    ).map((row) => row.collectionId)

    const collectionsToRemove = currentCollectionIds.filter(
      (id) => !collectionIds.includes(id),
    )
    const collectionsToAdd = collectionIds.filter(
      (id) => !currentCollectionIds.includes(id),
    )

    // Remove from collections
    if (collectionsToRemove.length > 0) {
      await db
        .delete(bookmarksCollections)
        .where(
          and(
            eq(bookmarksCollections.bookmarkId, bookmarkId),
            inArray(bookmarksCollections.collectionId, collectionsToRemove),
          ),
        )
      await db
        .update(collections)
        .set({ updatedAt: new Date() })
        .where(inArray(collections.id, collectionsToRemove))
    }

    if (collectionsToAdd.length > 0) {
      const newRelations: NewBookmarkCollection[] = collectionsToAdd.map(
        (collectionId) => ({
          bookmarkId,
          collectionId,
          addedAt: new Date(),
        }),
      )
      await db.insert(bookmarksCollections).values(newRelations)
      await db
        .update(collections)
        .set({ updatedAt: new Date() })
        .where(inArray(collections.id, collectionsToAdd))
    }

    if (collectionsToRemove.length > 0) {
      const remainingCollectionsCount = await db
        .select({ value: count() })
        .from(bookmarksCollections)
        .where(eq(bookmarksCollections.bookmarkId, bookmarkId))

      if (remainingCollectionsCount[0].value === 0) {
        await unbookmark(bookmarkId, userId)
        return null
      }
    }
  }

  return updatedBookmark
}

/**
 * Deletes a bookmark entirely and removes it from all collections.
 */
export async function unbookmark(id: string, userId: string) {
  await db
    .delete(bookmarksCollections)
    .where(eq(bookmarksCollections.bookmarkId, id))

  const [deleted] = await db
    .delete(bookmarks)
    .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, userId)))
    .returning()

  return deleted
}

/**
 * Removes a bookmark from specific collections.
 * If the bookmark becomes orphaned (no collections left), it is deleted.
 */
export async function removeBookmarkFromCollections(
  bookmarkId: string,
  collectionIds: string[],
  userId: string,
): Promise<boolean> {
  if (collectionIds.length === 0) {
    return true // Nothing to remove
  }

  // Verify the bookmark belongs to the user before proceeding
  const bookmark = await getBookmarkById(bookmarkId, userId)
  if (!bookmark) {
    console.warn(
      `Bookmark ${bookmarkId} not found for user ${userId}. Cannot remove from collections.`,
    )
    return false // Bookmark not found or doesn't belong to user
  }

  const deletedCount = (
    await db
      .delete(bookmarksCollections)
      .where(
        and(
          eq(bookmarksCollections.bookmarkId, bookmarkId),
          inArray(bookmarksCollections.collectionId, collectionIds),
        ),
      )
      .returning()
  ).length

  if (deletedCount > 0) {
    // Update `updatedAt` for collections from which bookmark was removed
    await db
      .update(collections)
      .set({ updatedAt: new Date() })
      .where(inArray(collections.id, collectionIds))

    // Check if the bookmark is now orphaned
    const remainingCollectionsCount = await db
      .select({ value: count() })
      .from(bookmarksCollections)
      .where(eq(bookmarksCollections.bookmarkId, bookmarkId))

    if (remainingCollectionsCount[0].value === 0) {
      // If no collections left, delete the bookmark itself
      await unbookmark(bookmarkId, userId)
    }
  }

  return deletedCount > 0
}

export async function getCollectionsForBookmark(
  bookmarkId: string,
  userId: string,
) {
  const place = await getBookmarkById(bookmarkId, userId)
  if (!place) return []

  const bookmarkCollections = await db
    .select()
    .from(bookmarksCollections)
    .where(eq(bookmarksCollections.bookmarkId, bookmarkId))

  if (bookmarkCollections.length === 0) return []

  const collectionIds = bookmarkCollections.map(
    (bc: BookmarkCollection) => bc.collectionId,
  )

  return await db
    .select()
    .from(collections)
    .where(
      and(
        inArray(collections.id, collectionIds),
        eq(collections.userId, userId), // Ensure collections belong to the user
      ),
    )
}

export async function findBookmarkByExternalIds(
  externalIds: Record<string, string>,
  userId: string,
): Promise<{ bookmark: Bookmark; collectionIds: string[] } | null> {
  if (!externalIds || Object.keys(externalIds).length === 0) {
    return null
  }

  // Find bookmark matching any of the external IDs
  // This is tricky with jsonb, might need a more specific query if performance is an issue
  // For now, fetching all and filtering in code is simpler but less efficient
  const userBookmarks = await db
    .select(bookmarkSelectFields)
    .from(bookmarks)
    .where(eq(bookmarks.userId, userId))

  const foundBookmark = userBookmarks.find((bm) => {
    const bmExternalIds = bm.externalIds as Record<string, string>
    return Object.entries(externalIds).some(([provider, id]) => {
      return bmExternalIds && bmExternalIds[provider] === id
    })
  })

  if (!foundBookmark) {
    return null
  }

  // Find associated collection IDs
  const collectionLinks = await db
    .select({ collectionId: bookmarksCollections.collectionId })
    .from(bookmarksCollections)
    .where(eq(bookmarksCollections.bookmarkId, foundBookmark.id))

  const collectionIds = collectionLinks.map((link) => link.collectionId)

  return {
    bookmark: foundBookmark as Bookmark,
    collectionIds,
  }
}

/**
 * Search bookmarks for the given user and query
 */
export async function searchBookmarks(
  userId: string,
  query: string,
): Promise<Bookmark[]> {
  if (!query || query.length === 0) {
    // 0 characters: return all bookmarks (preset and non-preset)
    const allBookmarks = await db
      .select(bookmarkSelectFields)
      .from(bookmarks)
      .where(eq(bookmarks.userId, userId))

    return allBookmarks.map((bookmark) => bookmark as Bookmark)
  }

  // Use PostgreSQL native text search with pg_trgm
  const searchCondition = createBookmarkSearchCondition(
    bookmarks.name,
    bookmarks.address,
    bookmarks.presetType,
    query,
  )

  if (!searchCondition) {
    return []
  }

  const searchResults = await db
    .select(bookmarkSelectFields)
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, userId), searchCondition))

  return searchResults.map((bookmark) => bookmark as Bookmark)
}
