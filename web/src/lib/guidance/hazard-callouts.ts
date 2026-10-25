// How hazards ahead show on the map: lights and rail crossings as plain signs on
// the route, the other alertable kinds as bubbles, both clear of the next turn's.

import type { RouteHazardKind } from '@/types/directions.types'
import { palette } from '@/lib/palette'
import { isAlertable, isAtTurn } from './hazards'
import type { NavHazard, NavRoute } from './nav-route'

export type HazardTone = 'caution' | 'danger'

export interface HazardCallout {
  hazard: NavHazard
  tone: HazardTone
  /** Icon only: every bubble but the nearest. */
  compact: boolean
}

export const HAZARD_TONE_COLORS: Record<HazardTone, { background: string; foreground: string }> = {
  caution: { background: palette.amber[400], foreground: palette.amber[950] },
  danger: { background: palette.compass[500], foreground: '#ffffff' },
}

export const HAZARD_SIGN_KINDS = ['traffic_signals', 'rail_crossing'] as const
export type HazardSignKind = (typeof HAZARD_SIGN_KINDS)[number]

const SIGNS = new Set<RouteHazardKind>(HAZARD_SIGN_KINDS)
const DANGER_KINDS = new Set<RouteHazardKind>(['ford'])
const MAX_CALLOUTS = 3
const MIN_RANGE_METERS = 250
const RANGE_SEC = 30
/** Nearer the next turn than this, a bubble would sit on the turn's. */
const TURN_CLEARANCE_METERS = 25
/** A sign this close to the turn is under the turn bubble's tail. */
export const SIGN_TURN_CLEARANCE_METERS = 12
/** Hazards closer together than this would stack into one blob; a sign wins over a bubble. */
const SPACING_METERS = 20

export function isHazardSign(kind: RouteHazardKind): kind is HazardSignKind {
  return SIGNS.has(kind)
}

export function hazardTone(kind: RouteHazardKind): HazardTone {
  return DANGER_KINDS.has(kind) ? 'danger' : 'caution'
}

/** Alertable hazards ahead of `s` that aren't signs, nearest first, within a speed-scaled range. */
export function hazardCallouts(route: NavRoute, s: number, speed: number, turnAt: number | null): HazardCallout[] {
  const range = Math.max(MIN_RANGE_METERS, speed * RANGE_SEC)
  const callouts: HazardCallout[] = []
  let last = -Infinity
  for (const hazard of route.hazards) {
    const distance = hazard.startDistance - s
    if (distance < 0) continue
    if (distance > range || callouts.length === MAX_CALLOUTS) break
    if (!isAlertable(hazard) || isHazardSign(hazard.kind) || isAtTurn(route, hazard)) continue
    if (turnAt != null && Math.abs(hazard.startDistance - turnAt) < TURN_CLEARANCE_METERS) continue
    if (hazard.startDistance - last < SPACING_METERS || nearSign(route, hazard)) continue
    last = hazard.startDistance
    callouts.push({ hazard, tone: hazardTone(hazard.kind), compact: callouts.length > 0 })
  }
  return callouts
}

function nearSign(route: NavRoute, hazard: NavHazard): boolean {
  return route.hazards.some(h => isHazardSign(h.kind) && Math.abs(h.startDistance - hazard.startDistance) < SPACING_METERS)
}
