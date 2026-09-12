/**
 * What the map is focused on when a transit itinerary is open.
 *
 * A trip is a sequence of legs, each riding one line for part of its
 * length. These helpers reduce a trip to the two things the map needs:
 * which lines to keep at full strength, and which vehicles on them are
 * the ones the rider is actually catching.
 */

import { splitFeedId } from '@/lib/transit/transit-alerts'
import type { TransitVehiclePosition } from '@/types/multimodal.types'

/** A stop the map may have to place, in the one shape both a route's stop
 *  list and a leg's stop list reduce to. */
export interface FocusedStop {
  stopId: string
  name: string
  lat: number
  lng: number
}

/** One transit leg, in the terms the vehicle feed is keyed by. */
export interface FocusedLeg {
  segmentIndex: number
  feedId: string
  /** The leg's line plus its interchangeable alternates (the 4 and the 5),
   *  which are one leg to the rider and must both stay lit. */
  routeIds: string[]
  /** The run the rider is booked on, feed-local. Null until something can
   *  name it. */
  tripId: string | null
  /** Every stop the leg calls at, ends included. */
  stops: FocusedStop[]
  /** The line's own colour, as the trip's polyline draws it (`#rrggbb`), or
   *  null for a feed that publishes none. */
  color: string | null
}

/** Feed-local id, or null when there is nothing to strip. */
function local(id: string | undefined | null): string | null {
  if (!id) return null
  const { localId } = splitFeedId(id)
  return localId || null
}

/**
 * The transit legs of a trip, or an empty list for a trip with none.
 *
 * Legs whose route carries no feed prefix are dropped: an unprefixed id
 * addresses whichever feed happens to be first, and lighting up the wrong
 * agency's line is worse than lighting up none.
 */
export function focusedLegs(trip: { segments?: unknown[] } | null | undefined): FocusedLeg[] {
  const segments = (trip?.segments ?? []) as Array<Record<string, any>>
  const out: FocusedLeg[] = []

  segments.forEach((seg, segmentIndex) => {
    if (seg.mode !== 'transit') return
    const td = seg.transitDetails
    const routeId: string | undefined = td?.route?.id
    if (!routeId) return
    const { feedId, localId } = splitFeedId(routeId)
    if (!feedId || !localId) return

    const routeIds = [
      localId,
      ...((td?.routeOptions ?? []) as Array<{ id?: string }>)
        .map((r) => local(r.id))
        .filter(Boolean) as string[],
    ]

    const stops: FocusedStop[] = ((td?.stops ?? []) as Array<Record<string, any>>)
      .map((s) => ({
        stopId: local(s?.id) ?? '',
        name: s?.name ?? '',
        lat: s?.location?.lat,
        lng: s?.location?.lng,
      }))
      .filter((s) => s.stopId && Number.isFinite(s.lat) && Number.isFinite(s.lng))

    const color = td?.route?.color ?? td?.color ?? null

    out.push({
      segmentIndex,
      feedId,
      routeIds: [...new Set(routeIds)],
      tripId: local(td?.trip?.id),
      stops,
      color: color ? (color.startsWith('#') ? color : `#${color}`) : null,
    })
  })

  return out
}

/** The legs' lines grouped by the feed that publishes them. */
export function routeIdsByFeed(legs: FocusedLeg[]): Map<string, string[]> {
  const byFeed = new Map<string, Set<string>>()
  for (const leg of legs) {
    const set = byFeed.get(leg.feedId) ?? new Set<string>()
    for (const id of leg.routeIds) set.add(id)
    byFeed.set(leg.feedId, set)
  }
  return new Map([...byFeed].map(([feedId, ids]) => [feedId, [...ids]]))
}

/** GTFS-RT prefixes a vehicle's trip with its feed; the boards do not. */
export function localTripId(vehicle: TransitVehiclePosition): string | null {
  if (!vehicle.tripId) return null
  return vehicle.tripId.startsWith(`${vehicle.feedId}_`)
    ? vehicle.tripId.slice(vehicle.feedId.length + 1)
    : vehicle.tripId
}

/**
 * The vehicles the rider is actually catching — one per leg, matched by
 * the run's trip id.
 *
 * Empty when no leg can be matched. Showing the whole line's service
 * instead is not the fallback: it puts a field of trains on the map with
 * the rider's somewhere among them, which is what this replaced.
 */
export function yourVehicleIds(
  legs: FocusedLeg[],
  vehicles: Iterable<TransitVehiclePosition>,
): Set<string> {
  const wanted = new Map<string, Set<string>>()
  for (const leg of legs) {
    if (!leg.tripId) continue
    const set = wanted.get(leg.feedId) ?? new Set<string>()
    set.add(leg.tripId)
    wanted.set(leg.feedId, set)
  }
  if (!wanted.size) return new Set()

  const out = new Set<string>()
  for (const v of vehicles) {
    const trips = wanted.get(v.feedId)
    if (!trips) continue
    const tripId = localTripId(v)
    if (tripId && trips.has(tripId)) out.add(v.vehicleId)
  }
  return out
}
