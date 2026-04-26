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
import {
  createSelectFieldsWithGeometry,
  createPointFromCoordinates,
} from '../../util/geometry-conversion'
import { createBookmarkSearchCondition } from '../../util/text-search.util'
import { emit } from '../realtime/emit'

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
      iconPack: params.iconPack || 'lucide',
      iconColor: params.iconColor || '#F43F5E',
      presetType: params.presetType,
      userId: params.userId,
    })
    .returning(bookmarkReturningFields)

  return inserted as Bookmark
}

/**
 * Creates a bookmark and assigns it to specified collections. Callers must
 * supply at least one collection — the controller rejects empty input
 * upstream.
 */
export async function createBookmark(
  params: CreateBookmarkParams,
  collectionIds: string[],
): Promise<Bookmark> {
  const bookmark = await createBookmarkInternal(params)

  const relations: NewBookmarkCollection[] = collectionIds.map(
    (collectionId) => ({
      bookmarkId: bookmark.id,
      collectionId,
      addedAt: new Date(),
    }),
  )

  await db.insert(bookmarksCollections).values(relations)
  await db
    .update(collections)
    .set({ updatedAt: new Date() })
    .where(inArray(collections.id, collectionIds))

  // Fan out to everyone who can see any of the target collections. The
  // payload carries the collectionIds so recipients can link the new
  // bookmark into their collections store without a follow-up fetch.
  await emit.bookmarkAcrossCollections(
    'bookmark:created',
    { ...bookmark, collectionIds },
    collectionIds,
  )

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

  // Separate the two paths:
  //   - If any bookmark-row fields changed (name, icon, lat/lng, etc.),
  //     only the bookmark's owner may update those. `updateBookmarkInternal`
  //     enforces that via its `userId` filter.
  //   - If ONLY `collectionIds` changed, we're really just editing pivot
  //     rows. A collection owner or editor should be able to add/remove
  //     a bookmark from their collection even when someone else created
  //     it (e.g. Alice removing a bookmark Bob added as editor to her
  //     shared collection). Skip the bookmark-row update in that case
  //     and fall through to the membership diff. The controller's
  //     `assertCanWriteCollections` already gated on collection access.
  const hasBookmarkFieldChanges = Object.keys(bookmarkUpdates).length > 0

  let updatedBookmark: Bookmark | undefined
  if (hasBookmarkFieldChanges) {
    updatedBookmark = await updateBookmarkInternal(
      bookmarkId,
      userId,
      bookmarkUpdates,
    )
    if (!updatedBookmark) return null
  } else {
    // Collection-only update. Look up the row as it stands (no userId
    // filter — access control has already happened one level up). If
    // the bookmark doesn't exist at all, null out as before.
    const [row] = await db
      .select(bookmarkSelectFields)
      .from(bookmarks)
      .where(eq(bookmarks.id, bookmarkId))
      .limit(1)
    if (!row) return null
    updatedBookmark = row as Bookmark
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
        // Bookmark is orphaned — delete the row directly and emit
        // `bookmark:deleted` with the pre-delete collection set.
        //
        // We can't route through `unbookmark(...)` here because its
        // internal "snapshot former collections" query would come back
        // empty — the pivot rows were already deleted above. Doing the
        // delete inline with the captured `currentCollectionIds` is the
        // straightforward fix (previously this path silently fired no
        // events, so shared recipients never saw the removal).
        await db.delete(bookmarks).where(eq(bookmarks.id, bookmarkId))
        await emit.bookmarkAcrossCollections(
          'bookmark:deleted',
          { id: bookmarkId, collectionIds: currentCollectionIds },
          currentCollectionIds,
        )
        return null
      }
    }

    // Emit an `unlinked` event to everyone who could see the removed
    // collections, so shared recipients drop the bookmark from their view
    // even though the bookmark itself still exists elsewhere.
    if (collectionsToRemove.length > 0) {
      await emit.bookmarkAcrossCollections(
        'bookmark:unlinked',
        { id: bookmarkId, collectionIds: collectionsToRemove },
        collectionsToRemove,
      )
    }
  }

  // Emit to everyone who can currently see the bookmark (the post-update
  // collection set). The payload carries the current collectionIds so
  // recipients can sync their collections store's bookmarkIds arrays
  // without a follow-up fetch.
  const currentCollectionIds = (
    await db
      .select({ collectionId: bookmarksCollections.collectionId })
      .from(bookmarksCollections)
      .where(eq(bookmarksCollections.bookmarkId, bookmarkId))
  ).map((row) => row.collectionId)
  await emit.bookmark(
    'bookmark:updated',
    { ...updatedBookmark, collectionIds: currentCollectionIds },
    bookmarkId,
  )

  return updatedBookmark
}

/**
 * Deletes a bookmark entirely and removes it from all collections.
 */
export async function unbookmark(id: string, userId: string) {
  // Snapshot the collection ids before we drop the pivot rows — we need
  // them to resolve recipients for the delete event.
  const formerCollectionIds = (
    await db
      .select({ collectionId: bookmarksCollections.collectionId })
      .from(bookmarksCollections)
      .where(eq(bookmarksCollections.bookmarkId, id))
  ).map((row) => row.collectionId)

  await db
    .delete(bookmarksCollections)
    .where(eq(bookmarksCollections.bookmarkId, id))

  const [deleted] = await db
    .delete(bookmarks)
    .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, userId)))
    .returning()

  if (deleted && formerCollectionIds.length > 0) {
    await emit.bookmarkAcrossCollections(
      'bookmark:deleted',
      { id, collectionIds: formerCollectionIds },
      formerCollectionIds,
    )
  }

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

    // Notify removed-collection recipients so their view drops the row.
    await emit.bookmarkAcrossCollections(
      'bookmark:unlinked',
      { id: bookmarkId, collectionIds },
      collectionIds,
    )

    // Check if the bookmark is now orphaned
    const remainingCollectionsCount = await db
      .select({ value: count() })
      .from(bookmarksCollections)
      .where(eq(bookmarksCollections.bookmarkId, bookmarkId))

    if (remainingCollectionsCount[0].value === 0) {
      // Bookmark is orphaned. Delete the row directly and emit
      // `bookmark:deleted` with the collection set it *was* in (just
      // deleted above). Going through `unbookmark(...)` would snapshot
      // an empty set because the pivot rows are already gone, so its
      // emit would have no recipients.
      await db.delete(bookmarks).where(eq(bookmarks.id, bookmarkId))
      await emit.bookmarkAcrossCollections(
        'bookmark:deleted',
        { id: bookmarkId, collectionIds },
        collectionIds,
      )
    }
  }

  return deletedCount > 0
}

export async function getCollectionsForBookmark(
  bookmarkId: string,
  userId: string,
) {
  // Don't pre-check bookmark ownership: an editor on a shared collection
  // adds bookmarks under the collection OWNER's user_id, and we still
  // want the editor/viewer to see "this bookmark is in these collections"
  // in their picker. Access control happens at the collection level —
  // the final filter only returns collections the caller either owns
  // or has an active share on.
  const bookmarkCollections = await db
    .select()
    .from(bookmarksCollections)
    .where(eq(bookmarksCollections.bookmarkId, bookmarkId))

  if (bookmarkCollections.length === 0) return []

  const collectionIds = bookmarkCollections.map(
    (bc: BookmarkCollection) => bc.collectionId,
  )

  // Split into owned + shared. Owned: straight lookup. Shared: via
  // incoming_shares. Union of the two is what the caller can see.
  const { incomingShares } = await import('../../schema/shares.schema')
  const { or } = await import('drizzle-orm')

  const owned = await db
    .select()
    .from(collections)
    .where(
      and(
        inArray(collections.id, collectionIds),
        eq(collections.userId, userId),
      ),
    )

  const sharedIdRows = await db
    .select({ collectionId: incomingShares.resourceId })
    .from(incomingShares)
    .where(
      and(
        eq(incomingShares.userId, userId),
        eq(incomingShares.resourceType, 'collection'),
        inArray(incomingShares.resourceId, collectionIds),
        or(
          eq(incomingShares.status, 'accepted'),
          eq(incomingShares.status, 'pending'),
        ),
      ),
    )

  const sharedIds = sharedIdRows.map((r) => r.collectionId)
  const shared =
    sharedIds.length > 0
      ? await db
          .select()
          .from(collections)
          .where(inArray(collections.id, sharedIds))
      : []

  // Merge and dedupe by id.
  const byId = new Map<string, (typeof owned)[number]>()
  for (const c of owned) byId.set(c.id, c)
  for (const c of shared) byId.set(c.id, c)
  return Array.from(byId.values())
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
