import { db } from '../../db'
import {
  bookmarks,
  collections,
  placesCollections,
} from '../../schema/library.schema'
import { and, eq, desc, inArray } from 'drizzle-orm'
import {
  CreateBookmarkParams,
  NewBookmark,
  Bookmark,
  PlaceCollection,
} from '../../types/library.types'
import { generateId } from '../../util'

export async function getBookmarks(userId: string) {
  return await db
    .select()
    .from(bookmarks)
    .where(eq(bookmarks.userId, userId))
    .orderBy(desc(bookmarks.createdAt))
}

export async function getBookmarkById(id: string, userId: string) {
  return (
    await db
      .select()
      .from(bookmarks)
      .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, userId)))
  )[0]
}

export async function createBookmark(params: CreateBookmarkParams) {
  const newPlace: NewBookmark = {
    id: generateId(),
    externalIds: params.externalIds,
    name: params.name,
    address: params.address,
    icon: params.icon || 'map-pin',
    iconColor: params.iconColor || '#F43F5E',
    presetType: params.presetType,
    userId: params.userId,
  }

  const [inserted] = await db.insert(bookmarks).values(newPlace).returning()
  return inserted
}

export async function updateBookmark(
  id: string,
  userId: string,
  updates: Partial<Bookmark>,
) {
  // Don't allow updating externalIds or userId
  const { externalIds, userId: _, id: __, ...validUpdates } = updates

  const [updated] = await db
    .update(bookmarks)
    .set({
      ...validUpdates,
    })
    .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, userId)))
    .returning()

  return updated
}

export async function unsavePlace(id: string, userId: string) {
  // Remove associations first
  await db.delete(placesCollections).where(eq(placesCollections.placeId, id))

  const [deleted] = await db
    .delete(bookmarks)
    .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, userId)))
    .returning()

  return deleted
}

export async function getCollectionsForPlace(placeId: string, userId: string) {
  // Verify the place belongs to the user
  const place = await getBookmarkById(placeId, userId)
  if (!place) return []

  // Get the junction table entries
  const placeCollections = await db
    .select()
    .from(placesCollections)
    .where(eq(placesCollections.placeId, placeId))

  if (placeCollections.length === 0) return []

  // Get the collection IDs
  const collectionIds = placeCollections.map(
    (pc: PlaceCollection) => pc.collectionId,
  )

  // Get the actual collections belonging to the user
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

// Helper type to enforce required fields when creating bookmarks
