/**
 * Transfers that leave the paid area: off one line, up to the street, and
 * back through the turnstiles at a different station (F at Jay St–MetroTech
 * to the 4 at Borough Hall). The engine treats them as an ordinary footpath;
 * a rider pays again and finds no signage for them.
 *
 * Whether a transfer stays inside is the agency's own answer: the lines
 * reachable from the alighting station through its complex and transfers.txt.
 */

import type { TripResponse, TripSegment } from '../../types/trip.types'

const STATION_TYPES = new Set(['subway', 'rail', 'monorail', 'funicular'])

/** A walk between two station legs of one feed, and what it walks to. */
export interface TransferCheck {
  walkIndex: number
  feedId: string
  /** Raw GTFS stop id the rider alights at. */
  alightStopId: string
  /** Raw GTFS route id boarded after the walk. */
  boardRouteId: string
}

/** `5_A41N` → `{ feedId: '5', id: 'A41N' }`; MOTIS prefixes ids with their feed. */
export function splitFeedScopedId(id: string | undefined): { feedId: string; id: string } | null {
  const split = id?.indexOf('_') ?? -1
  if (!id || split <= 0) return null
  return { feedId: id.slice(0, split), id: id.slice(split + 1) }
}

const stationLeg = (seg: TripSegment | undefined) =>
  seg?.mode === 'transit' && STATION_TYPES.has(seg.details?.transitDetails?.route?.type ?? '')

/** Every transfer in the trip whose fare-zone status the feed can answer. */
export function transferChecks(segments: TripSegment[]): TransferCheck[] {
  const checks: TransferCheck[] = []
  segments.forEach((seg, i) => {
    if (seg.mode !== 'walking' || !stationLeg(segments[i - 1]) || !stationLeg(segments[i + 1])) return
    const alight = splitFeedScopedId(segments[i - 1].details!.transitDetails!.arrivalStop.id)
    const board = splitFeedScopedId(segments[i + 1].details!.transitDetails!.route.id)
    if (!alight || !board || alight.feedId !== board.feedId) return
    checks.push({ walkIndex: i, feedId: alight.feedId, alightStopId: alight.id, boardRouteId: board.id })
  })
  return checks
}

/**
 * Drop trips with a street transfer when a trip without one arrives within
 * `toleranceMs` of it. With no such alternative the trip stays: an extra
 * fare beats no way there.
 */
export function dropAvoidableStreetTransfers(
  trips: TripResponse[],
  toleranceMs: number,
): TripResponse[] {
  const arrival = (t: TripResponse) => Date.parse(t.latestEndTime)
  const inSystem = trips.filter(
    (t) =>
      t.segments.some((s) => s.mode === 'transit') &&
      t.segments.every((s) => s.mode === 'transit' || s.mode === 'walking') &&
      !hasStreetTransfer(t),
  )
  return trips.filter(
    (t) =>
      !hasStreetTransfer(t) ||
      !inSystem.some((alt) => arrival(alt) <= arrival(t) + toleranceMs),
  )
}

export function hasStreetTransfer(trip: TripResponse): boolean {
  return trip.segments.some((s) => s.streetTransfer)
}
