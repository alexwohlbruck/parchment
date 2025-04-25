import { db } from '../db'
import {
  savedPlaces,
  collections,
  placesCollections,
} from '../schema/library.schema'
import { and, eq, desc, inArray } from 'drizzle-orm'
import { getPlaceDetails } from './place.service'
import {
  CreateSavedPlaceParams,
  CreateCollectionParams,
  NewSavedPlace,
  NewCollection,
  NewPlaceCollection,
  SavedPlace,
  Collection,
  PlaceCollection,
} from '../types/library.types'
import { generateId } from '../util'

export async function getSavedPlaces(userId: string) {
  return await db
    .select()
    .from(savedPlaces)
    .where(eq(savedPlaces.userId, userId))
    .orderBy(desc(savedPlaces.createdAt))
}

export async function getSavedPlaceById(id: string, userId: string) {
  return (
    await db
      .select()
      .from(savedPlaces)
      .where(and(eq(savedPlaces.id, id), eq(savedPlaces.userId, userId)))
  )[0]
}

export async function getSavedPlaceByExternalId(
  externalIdKey: string,
  externalIdValue: string,
  userId: string,
) {
  const places = await db
    .select()
    .from(savedPlaces)
    .where(eq(savedPlaces.userId, userId))

  return places.find((place: SavedPlace) => {
    const externalIds = place.externalIds as Record<string, string>
    return externalIds[externalIdKey] === externalIdValue
  })
}

export async function getSavedPlaceWithDetails(id: string, userId: string) {
  const savedPlace = await getSavedPlaceById(id, userId)

  if (!savedPlace) return null

  const externalIds = savedPlace.externalIds as Record<string, string>
  const osmId = externalIds.osm

  if (!osmId) return { savedPlace, details: null }

  try {
    const placeDetails = await getPlaceDetails(osmId)
    return { savedPlace, details: placeDetails }
  } catch (error) {
    console.error('Error fetching place details:', error)
    return { savedPlace, details: null }
  }
}

export async function createSavedPlace(params: CreateSavedPlaceParams) {
  const newPlace: NewSavedPlace = {
    id: generateId(),
    externalIds: params.externalIds,
    name: params.name,
    address: params.address,
    icon: params.icon || 'map-pin',
    iconColor: params.iconColor || '#F43F5E',
    presetType: params.presetType,
    userId: params.userId,
  }

  const [inserted] = await db.insert(savedPlaces).values(newPlace).returning()
  return inserted
}

export async function updateSavedPlace(
  id: string,
  userId: string,
  updates: Partial<SavedPlace>,
) {
  const { externalIds, userId: _, id: __, ...validUpdates } = updates

  const [updated] = await db
    .update(savedPlaces)
    .set({
      ...validUpdates,
    })
    .where(and(eq(savedPlaces.id, id), eq(savedPlaces.userId, userId)))
    .returning()

  return updated
}

export async function unsavePlace(id: string, userId: string) {
  await db.delete(placesCollections).where(eq(placesCollections.placeId, id))

  const [deleted] = await db
    .delete(savedPlaces)
    .where(and(eq(savedPlaces.id, id), eq(savedPlaces.userId, userId)))
    .returning()

  return deleted
}

export async function getCollections(userId: string) {
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

export async function createCollection(params: CreateCollectionParams) {
  const newCollection: NewCollection = {
    id: generateId(),
    name: params.name,
    description: params.description,
    icon: params.icon || 'folder',
    iconColor: params.iconColor || '#3B82F6',
    isPublic: params.isPublic || false,
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
  // First, verify the collection belongs to the user
  const collection = await getCollectionById(collectionId, userId)
  if (!collection) return []

  // Get the junction table entries
  const placeCollections = await db
    .select()
    .from(placesCollections)
    .where(eq(placesCollections.collectionId, collectionId))

  if (placeCollections.length === 0) return []

  // Get the place IDs
  const placeIds = placeCollections.map((pc: PlaceCollection) => pc.placeId)

  // Get the actual places
  return await db
    .select()
    .from(savedPlaces)
    .where(inArray(savedPlaces.id, placeIds))
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
  const place = await getSavedPlaceById(placeId, userId)
  const collection = await getCollectionById(collectionId, userId)

  if (!place || !collection) {
    throw new Error('Place or collection not found')
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

  return deleted
}

export async function getCollectionsForPlace(placeId: string, userId: string) {
  // Verify the place belongs to the user
  const place = await getSavedPlaceById(placeId, userId)
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

  // Get the actual collections
  return await db
    .select()
    .from(collections)
    .where(
      and(
        inArray(collections.id, collectionIds),
        eq(collections.userId, userId),
      ),
    )
}
