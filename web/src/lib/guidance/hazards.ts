import type { RouteHazard, RouteHazardKind } from '@/types/directions.types'
import type { NavHazard, NavRoute, NavStep } from './nav-route'

/** Worth a spoken alert and a banner chip; lights and signs show only on the map. */
const ALERT_KINDS = new Set<RouteHazardKind>([
  'crosswalk',
  'uncontrolled_crossing',
  'rail_crossing',
  'ford',
  'sharp_curve',
  'steep_grade',
  'steps',
  'shared_space',
  'tram_tracks',
  'tram_crossing',
  'unlit',
  'flood_prone',
  'icy_bridge',
  'school_zone',
  'no_sidewalk',
  'low_clearance',
  'speed_camera',
  'movable_bridge',
  'hazard',
])

const ALERT_LEAD_SEC = 12
const MIN_ALERT_METERS = 40
/** A crosswalk this soon after a turn belongs to the turn's prompt instead. */
export const TURN_CROSSWALK_METERS = 30

export function isAlertable(hazard: RouteHazard): boolean {
  if (!ALERT_KINDS.has(hazard.kind)) return false
  // A crosswalk at a light is covered by the light.
  return hazard.kind !== 'crosswalk' || hazard.severity === 'high'
}

export function alertDistance(speed: number): number {
  return Math.max(MIN_ALERT_METERS, speed * ALERT_LEAD_SEC)
}

/** The crosswalk just past a turn, which drivers cross while turning. */
export function crosswalkAfter(route: NavRoute, step: NavStep): NavHazard | null {
  return (
    route.hazards.find(
      h => h.kind === 'crosswalk' && h.startDistance >= step.startDistance && h.startDistance - step.startDistance <= TURN_CROSSWALK_METERS,
    ) ?? null
  )
}

export function isAtTurn(route: NavRoute, hazard: NavHazard): boolean {
  return hazard.kind === 'crosswalk' && route.steps.some(
    step => step.index > 0 && hazard.startDistance >= step.startDistance && hazard.startDistance - step.startDistance <= TURN_CROSSWALK_METERS,
  )
}

/** The nearest alertable hazard ahead, if it's within warning range. */
export function upcomingHazard(route: NavRoute, s: number, speed: number): { hazard: NavHazard; distance: number } | null {
  const range = alertDistance(speed)
  for (const hazard of route.hazards) {
    const distance = hazard.startDistance - s
    if (distance < 0) continue
    if (distance > range) return null
    if (isAlertable(hazard) && !isAtTurn(route, hazard)) return { hazard, distance }
  }
  return null
}

/** Hazards grouped by kind, most common first, for a trip's summary line. */
export function hazardCounts(hazards: RouteHazard[]): { kind: RouteHazardKind; count: number }[] {
  const counts = new Map<RouteHazardKind, number>()
  for (const hazard of hazards) counts.set(hazard.kind, (counts.get(hazard.kind) ?? 0) + 1)
  return [...counts.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count)
}
