/**
 * What the map is focused on when a transit itinerary is open.
 *
 * A trip is a sequence of legs, each riding one line for part of its
 * length. These helpers reduce a trip to the two things the map needs:
 * which lines to keep at full strength, and which vehicles on them are
 * the ones the rider is actually catching.
 */

import { splitFeedId } from '@/lib/transit-alerts'
import type { TransitVehiclePosition } from '@/types/multimodal.types'

/** A stop the map may have to place, in the one shape both a route's stop
 *  list and a leg's stop list reduce to. */
export interface FocusedStop {
  stopId: string
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
        lat: s?.location?.lat,
        lng: s?.location?.lng,
      }))
      .filter((s) => s.stopId && Number.isFinite(s.lat) && Number.isFinite(s.lng))

    out.push({
      segmentIndex,
      feedId,
      routeIds: [...new Set(routeIds)],
      tripId: local(td?.trip?.id),
      stops,
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

/** Vehicles running any of the trip's lines, on the feeds that publish them. */
export function vehiclesOnFocusedRoutes(
  legs: FocusedLeg[],
  vehicles: Iterable<TransitVehiclePosition>,
): Set<string> {
  const wanted = new Map<string, Set<string>>()
  for (const [feedId, ids] of routeIdsByFeed(legs)) wanted.set(feedId, new Set(ids))

  const out = new Set<string>()
  for (const v of vehicles) {
    const routes = wanted.get(v.feedId)
    if (!routes) continue
    if ((v.routeId && routes.has(v.routeId)) ||
        (v.routeShortName && routes.has(v.routeShortName))) {
      out.add(v.vehicleId)
    }
  }
  return out
}

/**
 * The vehicles the rider is actually catching — one per leg, matched by
 * the run's trip id.
 *
 * Empty when no leg can be matched, and the caller must read that as "do
 * not dim anything": every A train on screen is better than three of them
 * faded behind a fourth that is not the rider's.
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
