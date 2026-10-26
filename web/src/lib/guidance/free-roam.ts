// Free roam has no route, so it follows the path ahead instead: a short plan
// straight on from the traveller, replanned when they leave it or near its end.

import type { LngLat } from '@/types/map.types'
import { projectLatLng } from '@/lib/map/movement-interpolation'
import { edgeAt, type NavHazard, type NavRoute, type NavSegmentInput } from './nav-route'
import type { PuckState } from './guidance-engine'
import type { ProgressSummary } from './guidance-display'
import { upcomingHazard } from './hazards'

export type FreeMode = 'driving' | 'cycling' | 'walking'
export const FREE_MODES: FreeMode[] = ['driving', 'cycling', 'walking']

/** How far ahead the path is planned, and how close to its end it is replanned, in metres. */
const HORIZON: Record<FreeMode, { ahead: number; refresh: number }> = {
  driving: { ahead: 3000, refresh: 1000 },
  cycling: { ahead: 1200, refresh: 400 },
  walking: { ahead: 500, refresh: 150 },
}

export function freeModeFor(mode: string): FreeMode | null {
  const key = mode === 'biking' ? 'cycling' : mode
  return (FREE_MODES as string[]).includes(key) ? (key as FreeMode) : null
}

export function horizonTarget(position: LngLat, heading: number, mode: FreeMode): LngLat {
  return projectLatLng(position, HORIZON[mode].ahead, heading, 1)
}

/** The path ahead is a guess: its turns are not instructions, so nothing frames or announces them. */
export function horizonSegment(segment: NavSegmentInput, mode: FreeMode): NavSegmentInput {
  return {
    ...segment,
    mode,
    instructions: segment.instructions?.map(instruction => ({ ...instruction, modifier: 'straight' as const })),
    lanePlan: undefined,
  }
}

/** Off any road there is nothing to plan along; the traveller is assumed to carry straight on. */
export function straightSegment(position: LngLat, heading: number, mode: FreeMode): NavSegmentInput {
  return { mode, geometry: [position, horizonTarget(position, heading, mode)] }
}

export function needsHorizon(horizon: NavRoute | null, puck: PuckState | null, mode: FreeMode): boolean {
  if (!horizon || !puck || horizon.segments[0]?.mode !== mode) return true
  return !puck.snapped || horizon.length - puck.s < HORIZON[mode].refresh
}

/** Progress without a destination: only what the road under the puck says. */
export function roamProgress(horizon: NavRoute, puck: PuckState): ProgressSummary {
  return {
    remainingSeconds: 0,
    remainingMeters: 0,
    stepIndex: puck.stepIndex,
    next: null,
    then: null,
    distanceToNext: null,
    speedLimitKmh: puck.snapped ? edgeAt(horizon, puck.s)?.speedLimit ?? null : null,
  }
}

function hazardKey(hazard: NavHazard): string {
  return `${hazard.kind}:${hazard.coordinate.lat.toFixed(4)},${hazard.coordinate.lng.toFixed(4)}`
}

/** Raises each hazard ahead once, though the path it lies on is replanned under it. */
export class HazardWatch {
  private raised = new Set<string>()

  update(horizon: NavRoute, puck: PuckState): { hazard: NavHazard; distance: number } | null {
    if (!puck.snapped) return null
    const ahead = upcomingHazard(horizon, puck.s, puck.speed)
    if (!ahead) return null
    const key = hazardKey(ahead.hazard)
    if (this.raised.has(key)) return null
    this.raised.add(key)
    return ahead
  }
}
