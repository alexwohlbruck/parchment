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

function linesOf(trip: TripOption): string[] {
  return trip.segments.flatMap(segment => (segment.mode === 'transit' && segment.lineName ? [segment.lineName] : []))
}

const PLAIN_TRANSIT = new Set(['transit', 'transitWalking'])

/**
 * The trip Ask described: among trips riding the same lines (or all, when none
 * do), the best-ranked plain transit trip for transit, else of its kind, else the first.
 */
export function proposedTrip(
  trips: readonly TripOption[],
  kind: AskTripKind,
  lines: readonly string[] = [],
): TripOption | undefined {
  const ranked = byRank(trips)
  const sameLines = ranked.filter(trip => lines.length && linesOf(trip).join('|') === lines.join('|'))
  const pool = sameLines.length ? sameLines : ranked
  const plain = kind === 'transit' ? pool.find(trip => PLAIN_TRANSIT.has(tripType(trip.segments).key)) : undefined
  return plain ?? pool.find(trip => isKind(trip, kind)) ?? pool[0]
}
