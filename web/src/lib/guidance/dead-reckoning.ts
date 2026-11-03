// What the traveller could physically have done since the last fix worth
// trusting: how far they can have got, and how fast to carry the estimate.

import { edgeAt, segmentAt, type NavRoute } from './nav-route'
import { modeProfile } from './mode-profiles'

const MPS_PER_KMH = 1 / 3.6
/** Drivers exceed limits; this much over is still believable. */
const SPEEDING_FACTOR = 1.5
const MIN_DRIVING_SPEED = 15
const COAST_DECAY_SEC = 20
/** How far past the next maneuver an unconfirmed estimate may run. */
export const MANEUVER_OVERRUN = 15

/** Fastest believable speed at `s`, m/s: per mode, and per road when driving. */
export function plausibleSpeed(route: NavRoute, s: number): number {
  const mode = segmentAt(route, s)?.mode ?? 'driving'
  const profile = modeProfile(mode)
  const limit = mode === 'driving' ? edgeAt(route, s)?.speedLimit : null
  if (!limit) return profile.maxSpeed
  return Math.min(profile.maxSpeed, Math.max(MIN_DRIVING_SPEED, limit * MPS_PER_KMH * SPEEDING_FACTOR))
}

/** The furthest route distance reachable from `s` in `seconds`, segment by segment; past the end continues at the last mode's pace. */
export function reachAhead(route: NavRoute, s: number, seconds: number): number {
  let at = s
  let remaining = Math.max(0, seconds)
  for (let guard = 0; remaining > 0 && guard <= route.segments.length; guard++) {
    const speed = plausibleSpeed(route, at)
    const end = segmentAt(route, at)?.endDistance ?? route.length
    if (end >= route.length || at + speed * remaining <= end) return at + speed * remaining
    remaining -= (end - at) / speed
    at = end + 1e-6
  }
  return at
}

/** Distance along the route the estimate may not pass without a fix: just beyond the next maneuver after `s`. */
export function maneuverLimit(route: NavRoute, s: number): number {
  const next = route.steps.find(step => step.startDistance > s + 1)
  return next ? Math.min(route.length, next.startDistance + MANEUVER_OVERRUN) : route.length
}

export interface CoastInput {
  mode: string
  /** Speed when the last good fix came in. */
  speed: number
  /** Seconds since then. */
  lostFor: number
  /** Walking speed from the pedometer, null without a steady walk. */
  stepSpeed: number | null
  /** From the motion sensors; null without them. */
  still: boolean | null
}

/** Speed to carry the estimate at while fixes can't place it, and its 1σ. */
export function coastSpeed({ mode, speed, lostFor, stepSpeed, still }: CoastInput): { speed: number; sigma: number } {
  const profile = modeProfile(mode)
  if (still === true) return { speed: 0, sigma: 0.05 }
  if (stepSpeed != null && mode === 'walking') return { speed: Math.min(profile.maxSpeed, stepSpeed), sigma: 0.2 }
  const settled = Math.min(speed, profile.coastSpeed)
  const coasting = settled + Math.max(0, speed - settled) * Math.exp(-lostFor / COAST_DECAY_SEC)
  return { speed: coasting, sigma: Math.max(0.3, 0.4 * coasting) }
}
