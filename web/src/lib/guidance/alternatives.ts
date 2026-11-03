// Whether another way to finish the segment is worth offering mid-trip.

import type { LngLat } from '@/types/map.types'
import { distanceMeters } from '@/lib/map/movement-interpolation'
import { distanceAlong, pointAt, type NavRoute } from './nav-route'

export interface RouteMetrics {
  duration: number
  distance: number
  turns: number
  protectedShare: number
  majorRoadShare: number
  crossings: number
  via: string | null
}

export interface Candidate<T> {
  route: T
  metrics: RouteMetrics
  /** Share of the candidate that runs along the route being followed. */
  overlap: number
}

export type OfferReason = 'faster' | 'protected' | 'quieter'

export interface Offer<T> {
  route: T
  reason: OfferReason
  /** Seconds saved; negative when the gain is not time. */
  saved: number
  via: string | null
}

const ON_ROUTE_METERS = 25
const SAMPLE_METERS = 40
/** A candidate this much along the current route is the current route. */
const SAME_ROUTE = 0.7
const MIN_SAVING_SEC = 120
const MIN_SAVING_SHARE = 0.1
const MAX_PENALTY_SEC = 60
const PROTECTED_GAIN = 0.2
const MAJOR_ROAD_CUT = 0.2
const CROSSINGS_CUT = 0.8

export const CHECK_INTERVAL_MS = 120_000
const MIN_REMAINING_SEC = 600
const MIN_TO_MANEUVER_SEC = 70

/** Check only on a long stretch with no turn coming up. */
export function shouldCheck(remainingSec: number, toManeuverSec: number): boolean {
  return remainingSec > MIN_REMAINING_SEC && toManeuverSec > MIN_TO_MANEUVER_SEC
}

export function overlapShare(geometry: LngLat[], route: NavRoute, fromS: number): number {
  const samples: LngLat[] = []
  let since = Infinity
  for (let i = 0; i < geometry.length; i++) {
    since += i > 0 ? distanceMeters(geometry[i - 1], geometry[i]) : 0
    if (since >= SAMPLE_METERS) {
      samples.push(geometry[i])
      since = 0
    }
  }
  if (samples.length === 0) return 0
  const near = samples.filter(p => distanceMeters(p, pointAt(route, distanceAlong(route, p, fromS))) <= ON_ROUTE_METERS)
  return near.length / samples.length
}

/** The candidate that is the route already being followed, if one is. */
export function currentCandidate<T>(candidates: Candidate<T>[]): Candidate<T> | null {
  const closest = [...candidates].sort((a, b) => b.overlap - a.overlap)[0]
  return closest && closest.overlap >= SAME_ROUTE ? closest : null
}

/** The best candidate that beats the current route by enough to interrupt for. */
export function chooseOffer<T>(candidates: Candidate<T>[], mode: string, remainingSec: number): Offer<T> | null {
  const current = currentCandidate(candidates)
  const baseline: RouteMetrics | { duration: number } = current ? current.metrics : { duration: remainingSec }
  const others = candidates.filter(c => c !== current)

  const offers = others.flatMap((c): Offer<T>[] => {
    const saved = baseline.duration - c.metrics.duration
    const via = c.metrics.via
    if (saved >= Math.max(MIN_SAVING_SEC, MIN_SAVING_SHARE * baseline.duration)) return [{ route: c.route, reason: 'faster', saved, via }]
    if (saved < -MAX_PENALTY_SEC || !('turns' in baseline)) return []
    if ((mode === 'cycling' || mode === 'biking') && c.metrics.protectedShare >= baseline.protectedShare + PROTECTED_GAIN) {
      return [{ route: c.route, reason: 'protected', saved, via }]
    }
    const quieter =
      c.metrics.majorRoadShare <= baseline.majorRoadShare - MAJOR_ROAD_CUT ||
      c.metrics.crossings < baseline.crossings * CROSSINGS_CUT
    if (mode === 'walking' && quieter) return [{ route: c.route, reason: 'quieter', saved, via }]
    return []
  })
  return offers.sort((a, b) => b.saved - a.saved)[0] ?? null
}
