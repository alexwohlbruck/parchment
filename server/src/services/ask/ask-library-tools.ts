import {
  createBookmark,
  findBookmarkByExternalIds,
  getBookmarks,
  searchBookmarks,
  updateBookmark,
} from '../library/bookmarks.service'
import { getBookmarksInCollection, getCollections } from '../library/collections.service'
import { getUserVehicles } from '../vehicle.service'
import { getPermissions, hasPermission } from '../auth.service'
import { PermissionId } from '../../types/auth.types'
import { distanceText } from '../../lib/ask/distance-text'
import { distance } from '@turf/turf'
import { AskToolError, endpoint, pointSchema, type AskTool, type PointArg } from './ask-tool-base'

const MAX_SAVED = 25

const savedPlaces: AskTool<{ query?: string }> = {
  name: 'saved_places',
  description:
    "The user's saved places (not in private collections), with coordinates to plan trips or search near. Filter by name with query.",
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
  },
  label: () => 'Checking your saved places',
  detail: ({ query }) => query,
  async run({ query }, context) {
    const bookmarks = query?.trim()
      ? await searchBookmarks(context.userId, query.trim())
      : await getBookmarks(context.userId)
    const origin = context.places.get('here') ?? context.origin
    return bookmarks.slice(0, MAX_SAVED).map((bookmark) => ({
      name: bookmark.name,
      ...(bookmark.address && { address: bookmark.address }),
      ...(bookmark.frequentType && { kind: bookmark.frequentType }),
      lat: bookmark.lat,
      lng: bookmark.lng,
      ...(origin && {
        distance: distanceText(
          distance([origin.lng, origin.lat], [bookmark.lng, bookmark.lat], {
            units: 'meters',
          }),
          context.units,
        ),
      }),
    }))
  },
}

const myVehicles: AskTool<Record<string, never>> = {
  name: 'my_vehicles',
  description:
    'The user\'s own cars, bikes and scooters, and where each was last parked. For "where\'s my car".',
  parameters: { type: 'object', properties: {} },
  label: () => 'Checking your vehicles',
  async run(_args, context) {
    const vehicles = await getUserVehicles(context.userId)
    return vehicles.map((vehicle) => ({
      name: vehicle.name ?? vehicle.type,
      type: vehicle.type,
      in_use: vehicle.isActive,
      ...(vehicle.lastKnownLat != null &&
        vehicle.lastKnownLng != null && {
          parked_at: { lat: vehicle.lastKnownLat, lng: vehicle.lastKnownLng },
          parked_since: vehicle.locationUpdatedAt?.toISOString(),
        }),
    }))
  },
}

export async function requireLibrary(userId: string) {
  if (!hasPermission(await getPermissions(userId), PermissionId.LIBRARY_WRITE)) {
    throw new AskToolError('Saving to the library needs a Basic or Premium plan.')
  }
}

const SAMPLE = 3

/** The user's own collections a plaintext bookmark may join: private ones keep their places encrypted. */
async function writableCollections(userId: string) {
  const collections = await getCollections(userId)
  return collections
    .filter((collection) => collection.scheme !== 'user-e2ee' && !collection.archivedAt)
    .map((collection) => ({ id: collection.id, name: collection.name }))
}

const myCollections: AskTool<Record<string, never>> = {
  name: 'my_collections',
  description:
    "The user's collections of saved places that save_place can add to, with a few places in each. Some names are encrypted: tell those apart by their places. Private collections are not listed.",
  parameters: { type: 'object', properties: {} },
  label: () => 'Checking your collections',
  async run(_args, context) {
    const collections = await writableCollections(context.userId)
    return Promise.all(
      collections.map(async ({ id, name }) => {
        const places = await getBookmarksInCollection(id, context.userId)
        return {
          id,
          ...(name ? { name } : { name_hidden: true }),
          places: places.length,
          ...(places.length && { for_example: places.slice(0, SAMPLE).map((place) => place.name) }),
        }
      }),
    )
  },
}

const savePlace: AskTool<{ place: PointArg; collection_id?: string; name?: string }> = {
  name: 'save_place',
  description:
    "Save a place to one of the user's collections, only when they ask to save, bookmark or add it. Without collection_id it goes to their first collection.",
  parameters: {
    type: 'object',
    properties: {
      place: pointSchema('The place to save: a place id a tool returned.'),
      collection_id: { type: 'string', description: 'From my_collections' },
      name: { type: 'string', description: "Only to rename it, e.g. \"Mom's\"" },
    },
    required: ['place'],
  },
  label: () => 'Saving the place',
  async run(args, context) {
    await requireLibrary(context.userId)
    const point = await endpoint(args.place, context)
    const place = point.placeId ? context.seen.get(point.placeId) : undefined
    if (!place?.externalIds || !Object.keys(place.externalIds).length) {
      throw new AskToolError('Only a place a tool returned can be saved: find it first and pass its id.')
    }
    const collections = await writableCollections(context.userId)
    const collection = args.collection_id
      ? collections.find(({ id }) => id === args.collection_id)
      : collections[0]
    if (!collection) {
      throw new AskToolError(
        args.collection_id ? `Unknown collection ${args.collection_id}. Use an id my_collections returned.` : 'No collection to save into.',
      )
    }
    const name = args.name?.trim() || point.name || 'Place'
    const existing = await findBookmarkByExternalIds(place.externalIds, context.userId)
    if (existing) {
      if (!existing.collectionIds.includes(collection.id)) {
        await updateBookmark(existing.bookmark.id, context.userId, {
          collectionIds: [...existing.collectionIds, collection.id],
        })
      }
    } else {
      await createBookmark(
        {
          userId: context.userId,
          externalIds: place.externalIds,
          name,
          address: place.address?.value?.formatted,
          lat: point.lat,
          lng: point.lng,
          ...(place.icon && { icon: place.icon.icon, iconPack: place.icon.iconPack }),
        },
        [collection.id],
      )
    }
    return { saved: true, name, ...(collection.name && { collection: collection.name }) }
  },
}

export const libraryTools: AskTool[] = [savedPlaces, myVehicles, myCollections, savePlace]
