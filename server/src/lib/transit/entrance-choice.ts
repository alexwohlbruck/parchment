// The entrance that makes the whole walk shortest, not the one nearest the platform.
// The path inside the station is estimated from the straight line until a station graph exists.

import type { Coordinate } from '../../types/unified-routing.types'
import { haversineMeters } from '../../util/geometry-conversion'

const metersBetween = (a: Coordinate, b: Coordinate) => haversineMeters(a.lat, a.lng, b.lat, b.lng)

export type EntrancePurpose = 'enter' | 'exit'

export interface EntranceCandidate {
  lat: number
  lon: number
  entryAllowed?: boolean | null
  exitAllowed?: boolean | null
}

/** Paths inside a station wind through stairs and mezzanines. */
export const STATION_PATH_DETOUR = 1.3
/** Street walks are compared on GraphHopper for this many of the best guesses. */
export const ROUTED_CANDIDATES = 3

/** An exit-only entrance can't be entered by, nor an entry-only one left by. Unknown is allowed. */
export function usableFor(entrance: EntranceCandidate, purpose: EntrancePurpose): boolean {
  return purpose === 'enter' ? entrance.entryAllowed !== false : entrance.exitAllowed !== false
}

const at = (e: EntranceCandidate): Coordinate => ({ lat: e.lat, lng: e.lon })

/** Estimated metres inside the station, from the entrance to the platform. */
export function insideMeters(entrance: EntranceCandidate, platform: Coordinate): number {
  return metersBetween(at(entrance), platform) * STATION_PATH_DETOUR
}

/** Candidates by straight-line total walk via each one, best first. */
export function rankByCrowFlies<T extends EntranceCandidate>(
  candidates: T[],
  street: Coordinate,
  platform: Coordinate,
): T[] {
  const cost = (e: T) => metersBetween(street, at(e)) + insideMeters(e, platform)
  return [...candidates].sort((a, b) => cost(a) - cost(b))
}

/** The shortest whole walk, given each candidate's street metres (null: unroutable, ranked last). */
export function cheapestWalk<T extends EntranceCandidate>(
  candidates: T[],
  streetMeters: Array<number | null>,
  platform: Coordinate,
): T | null {
  let best: T | null = null
  let bestCost = Infinity
  candidates.forEach((e, i) => {
    const walk = streetMeters[i]
    if (walk == null) return
    const cost = walk + insideMeters(e, platform)
    if (cost < bestCost) {
      best = e
      bestCost = cost
    }
  })
  return best ?? candidates[0] ?? null
}
