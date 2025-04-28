import { db } from '../../db'
import { collections, placesCollections } from '../../schema/library.schema'
import { and, eq } from 'drizzle-orm'
import {
  CreateCollectionParams,
  NewCollection,
  NewPlaceCollection,
  Collection,
} from '../../types/library.types'
import { generateId } from '../../util'
import { getSavedPlaceById } from './saved-places.service' // Import from sibling service

export async function getCollections(userId: string) {
  // Ensure the default collection exists
  await ensureDefaultCollection(userId)

  // Then return all collections
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
    icon: 'bookmark',
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
    icon: params.icon || 'folder',
    iconColor: params.iconColor || '#3B82F6',
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
  // Don't allow updating userId
  const { userId: _, id: __, ...validUpdates } = updates

  const [updated] = await db
    .update(collections)
    .set({
      ...validUpdates,
    })
    .where(and(eq(collections.id, id), eq(collections.userId, userId)))
    .returning()

  return updated
}

export async function deleteCollection(id: string, userId: string) {
  // First, check if this is the default collection
  const collection = await getCollectionById(id, userId)
  if (collection && collection.isDefault) {
    throw new Error('Cannot delete the default collection')
  }

  // First, remove all place associations
  await db
    .delete(placesCollections)
    .where(eq(placesCollections.collectionId, id))

  // Then delete the collection itself
  const [deleted] = await db
    .delete(collections)
    .where(and(eq(collections.id, id), eq(collections.userId, userId)))
    .returning()

  return deleted
}

// ===== Places in Collections =====

export async function getPlacesInCollection(
  collectionId: string,
  userId: string,
) {
  // First, verify the collection exists and belongs to the user
  const collection = await getCollectionById(collectionId, userId)
  if (!collection) {
    // Or throw an error, depending on desired behavior
    return []
  }

  // Get the IDs of places linked to this collection
  const placeLinks = await db
    .select({ placeId: placesCollections.placeId })
    .from(placesCollections)
    .where(eq(placesCollections.collectionId, collectionId))

  if (placeLinks.length === 0) {
    return []
  }

  const placeIds = placeLinks.map((link) => link.placeId)

  // Fetch the actual saved places corresponding to these IDs, ensuring they belong to the user
  // We need to import savedPlaces schema and potentially inArray
  // Also need to import savedPlaces table definition from schema
  const { savedPlaces } = await import('../../schema/library.schema')
  const { inArray } = await import('drizzle-orm')

  const places = await db
    .select()
    .from(savedPlaces)
    .where(
      and(inArray(savedPlaces.id, placeIds), eq(savedPlaces.userId, userId)),
    )

  return places
}

export async function addPlaceToCollection(
  placeId: string,
  collectionId: string,
  userId: string,
) {
  // Verify both the place and collection belong to the user
  const place = await getSavedPlaceById(placeId, userId)
  const collection = await getCollectionById(collectionId, userId)

  if (!place || !collection) {
    throw new Error('Place or collection not found')
  }

  // Check if the relationship already exists
  const existing = (
    await db
      .select()
      .from(placesCollections)
      .where(
        and(
          eq(placesCollections.placeId, placeId),
          eq(placesCollections.collectionId, collectionId),
        ),
      )
  )[0]

  if (existing) {
    return existing // Already exists, just return it
  }

  // Create the relationship
  const newRelation: NewPlaceCollection = {
    placeId,
    collectionId,
    addedAt: new Date(),
  }

  const [inserted] = await db
    .insert(placesCollections)
    .values(newRelation)
    .returning()
  return inserted
}

export async function removePlaceFromCollection(
  placeId: string,
  collectionId: string,
  userId: string,
) {
  // Verify both the place and collection belong to the user
  // Note: We don't strictly need to fetch the collection here if we trust the foreign key constraints
  // or if the goal is simply to remove the link if it exists, regardless of collection ownership.
  // However, verifying ownership is generally safer.
  const place = await getSavedPlaceById(placeId, userId)
  const collection = await getCollectionById(collectionId, userId)

  if (!place || !collection) {
    // Decide if we should throw an error if the *collection* doesn't exist/belong to user,
    // or just proceed to delete the relationship if the *place* exists.
    // Current logic requires both to exist and belong to the user.
    throw new Error('Place or collection not found for this user')
  }

  // Delete the relationship
  const [deleted] = await db
    .delete(placesCollections)
    .where(
      and(
        eq(placesCollections.placeId, placeId),
        eq(placesCollections.collectionId, collectionId),
      ),
    )
    .returning()

  // We might want to return null or indicate failure if nothing was deleted
  return deleted
}

// Update a place in a collection (previously updateSavedPlace)
export async function updatePlaceInCollection(
  placeId: string,
  collectionId: string,
  userId: string,
  updates: any,
) {
  // First verify the place exists and belongs to the user
  const place = await getSavedPlaceById(placeId, userId)
  if (!place) {
    throw new Error('Place not found')
  }

  // Verify the collection exists and belongs to the user
  const collection = await getCollectionById(collectionId, userId)
  if (!collection) {
    throw new Error('Collection not found')
  }

  // Don't allow updating externalIds or userId
  const { externalIds, userId: _, id: __, ...validUpdates } = updates

  // Update the place
  const { savedPlaces } = await import('../../schema/library.schema')
  const [updated] = await db
    .update(savedPlaces)
    .set({
      ...validUpdates,
    })
    .where(and(eq(savedPlaces.id, placeId), eq(savedPlaces.userId, userId)))
    .returning()

  return updated
}
