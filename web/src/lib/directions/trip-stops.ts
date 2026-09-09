import type { Place } from '@/types/place.types'
import type { LngLat } from '@/types/map.types'

/**
 * A stop the plan makes on the traveller's behalf — the rack it parks the bike
 * at, the lot it leaves the car in. The planner hangs a full Place on the
 * waypoint the segment ends at, so the timeline and the map both read the
 * stops from here rather than each walking the segments themselves.
 */
export interface TripPlaceStop {
  id: string
  /** Index of the segment this stop ends. */
  segmentIndex: number
  place: Place
  label: string
  lngLat: LngLat
  /** When the trip reaches the stop. */
  time: string | null
}

export interface TripStopSegment {
  end?: {
    location?: { lat: number; lng: number }
    label?: string
    place?: Place
  }
  endTime?: string
}

/**
 * The final segment's end is the destination, which is a waypoint of its own —
 * only the boundaries between segments are stops the plan invented.
 */
export function tripPlaceStops(
  segments: TripStopSegment[] | undefined | null,
): TripPlaceStop[] {
  if (!segments) return []

  return segments.slice(0, -1).flatMap((segment, index) => {
    const end = segment.end
    const place = end?.place
    if (!place || !end?.location) return []

    return [
      {
        id: place.id ? `${index}-${place.id}` : String(index),
        segmentIndex: index,
        place,
        label: end.label || place.name?.value || 'Stop',
        lngLat: { lat: end.location.lat, lng: end.location.lng },
        time: segment.endTime ?? null,
      },
    ]
  })
}
