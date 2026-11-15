import { tripType } from '@/lib/directions/trip-type'
import { byRank } from '@/lib/directions/trip-display'
import { coordinatePlaceId } from '@/lib/search/local-search'
import { autocompleteResultToPlace } from '@/lib/search/search-result'
import type { AskEndpoint, AskTripKind } from '@/types/ask.types'
import type { TripOption } from '@/types/directions.types'
import type { Place } from '@/types/place.types'

/** An endpoint Ask named, as the place a Directions waypoint expects. */
export function endpointPlace(endpoint: AskEndpoint): Place {
  return autocompleteResultToPlace({
    id: endpoint.placeId ?? coordinatePlaceId(endpoint.lat, endpoint.lng),
    type: 'place',
    title: endpoint.name ?? `${endpoint.lat}, ${endpoint.lng}`,
    icon: 'MapPin',
    iconPack: 'lucide',
    lat: endpoint.lat,
    lng: endpoint.lng,
  })
}

function isKind(trip: TripOption, kind: AskTripKind): boolean {
  const { key, iconMode } = tripType(trip.segments)
  switch (kind) {
    case 'transit':
      return iconMode === 'transit'
    case 'biking':
      return key === 'cycling'
    default:
      return key === kind
  }
}

/** The best-ranked trip of the kind Ask proposed, or the best overall when the planner has none of it. */
export function proposedTrip(trips: readonly TripOption[], kind: AskTripKind): TripOption | undefined {
  const ranked = byRank(trips)
  return ranked.find(trip => isKind(trip, kind)) ?? ranked[0]
}
