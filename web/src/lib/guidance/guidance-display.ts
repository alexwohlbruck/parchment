// What the guidance UI shows, derived from the route and the puck: banner
// distances rounded the way people say them, the road being driven, timing.

import { edgeAt, segmentAt, type NavRoute, type NavStep } from './nav-route'
import type { PuckState } from './guidance-engine'
import { modeProfile } from './mode-profiles'

const FEET_PER_METER = 3.28084
const METERS_PER_MILE = 1609.344

export interface SpokenDistance {
  value: string
  unit: 'ft' | 'mi' | 'm' | 'km'
}

/** "0.4 mi", "500 ft", "50 ft" — coarse far away, fine close in. */
export function bannerDistance(meters: number, metric: boolean): SpokenDistance {
  const m = Math.max(0, meters)
  if (metric) {
    if (m >= 950) return { value: (m / 1000).toFixed(m >= 9500 ? 0 : 1), unit: 'km' }
    const step = m >= 200 ? 50 : 10
    return { value: String(Math.max(step === 10 ? 10 : 50, Math.round(m / step) * step)), unit: 'm' }
  }
  const miles = m / METERS_PER_MILE
  if (miles >= 0.19) return { value: miles.toFixed(miles >= 9.5 ? 0 : 1), unit: 'mi' }
  const feet = m * FEET_PER_METER
  const step = feet >= 300 ? 50 : 10
  return { value: String(Math.max(10, Math.round(feet / step) * step)), unit: 'ft' }
}

/** Road-class names for ways without one, until sidewalks resolve to their street. */
const GENERIC_ROADS: Record<string, string> = {
  footway: 'path',
  path: 'path',
  pedestrian: 'pedestrian',
  cycleway: 'cycleway',
  steps: 'steps',
  track: 'track',
  service: 'service',
}

export type RoadLabel =
  | { kind: 'named'; name: string; ref?: string }
  | { kind: 'generic'; key: string }

/** How far past a maneuver the label waits before naming the new road. */
const LABEL_SETTLE_METERS = 15

export function currentRoadStep(route: NavRoute, s: number): NavStep | null {
  let found: NavStep | null = null
  for (const step of route.steps) {
    if (step.startDistance + (step.index === 0 ? 0 : LABEL_SETTLE_METERS) > s) break
    found = step
  }
  return found
}

export function roadLabel(route: NavRoute, s: number): RoadLabel {
  const step = currentRoadStep(route, s)
  const name = step?.instruction.streetName?.trim()
  const ref = step?.instruction.streetRef?.trim()
  if (name) return { kind: 'named', name, ref: ref && ref !== name ? ref : undefined }
  if (ref) return { kind: 'named', name: ref }
  const roadClass = edgeAt(route, s)?.roadClass ?? ''
  return { kind: 'generic', key: GENERIC_ROADS[roadClass] ?? 'road' }
}

export interface ProgressSummary {
  /** Seconds left in the leg, from the planned segment durations. */
  remainingSeconds: number
  remainingMeters: number
  stepIndex: number
  next: NavStep | null
  /** The maneuver after `next`, when it follows closely enough to mention. */
  then: NavStep | null
  distanceToNext: number | null
  speedLimitKmh: number | null
}

const THEN_WITHIN_METERS = 150

export function summarizeProgress(route: NavRoute, puck: PuckState, durations: number[]): ProgressSummary {
  let remainingSeconds = 0
  for (const segment of route.segments) {
    const span = segment.endDistance - segment.startDistance
    const duration = durations[segment.index] ?? 0
    if (puck.s >= segment.endDistance || span <= 0) continue
    const left = Math.min(1, (segment.endDistance - Math.max(puck.s, segment.startDistance)) / span)
    remainingSeconds += duration * left
  }

  const next = route.steps[puck.stepIndex + 1] ?? null
  const afterNext = next ? route.steps[next.index + 1] ?? null : null
  const then =
    next && afterNext && afterNext.startDistance - next.startDistance <= THEN_WITHIN_METERS ? afterNext : null

  return {
    remainingSeconds,
    remainingMeters: Math.max(0, route.length - puck.s),
    stepIndex: puck.stepIndex,
    next,
    then,
    distanceToNext: next ? Math.max(0, next.startDistance - puck.s) : null,
    speedLimitKmh: edgeAt(route, puck.s)?.speedLimit ?? null,
  }
}

/** A speed limit in the driver's units: mph limits are posted in steps of 5. */
export function postedLimit(kmh: number, metric: boolean): number {
  return metric ? Math.round(kmh / 5) * 5 : Math.round(kmh / 1.609344 / 5) * 5
}


export function hasArrived(route: NavRoute, puck: PuckState): boolean {
  const mode = travelModeAt(route, puck.s)
  return route.length - puck.s <= modeProfile(mode).arrivalRadius
}

export function travelModeAt(route: NavRoute, s: number): string {
  return segmentAt(route, s)?.mode ?? 'driving'
}
