import { db } from '../../db'
import {
  savedPlaces,
  collections,
  placesCollections,
} from '../../schema/library.schema'
import { and, eq, desc, inArray } from 'drizzle-orm'
import {
  CreateSavedPlaceParams,
  NewSavedPlace,
  SavedPlace,
  PlaceCollection,
} from '../../types/library.types'
import { generateId } from '../../util'

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
  // Don't allow updating externalIds or userId
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
  // Remove associations first
  await db.delete(placesCollections).where(eq(placesCollections.placeId, id))

  const [deleted] = await db
    .delete(savedPlaces)
    .where(and(eq(savedPlaces.id, id), eq(savedPlaces.userId, userId)))
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
