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

  const newCollection: NewCollection = {
    id: generateId(),
    name: null,
    icon: 'Bookmark',
    iconColor: 'blue',
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
    name: params.name,
    description: params.description,
    icon: params.icon || 'Bookmark',
    iconColor: params.iconColor || 'blue',
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
