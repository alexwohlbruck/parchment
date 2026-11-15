import { getBookmarks, searchBookmarks } from '../library/bookmarks.service'
import { getUserVehicles } from '../vehicle.service'
import { distanceText } from '../../lib/ask/distance-text'
import { distance } from '@turf/turf'
import type { AskTool } from './ask-tool-base'

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

export const libraryTools: AskTool[] = [savedPlaces, myVehicles]
