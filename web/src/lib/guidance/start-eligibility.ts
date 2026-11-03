// Whether a trip can be navigated from where the traveller is, or only previewed.
// Any part of the route counts, not just its start: joining a route midway is fine.

import type { LngLat } from '@/types/map.types'
import { distanceToLine } from '@/lib/geo/geo-line'

export type StartEligibility = 'navigate' | 'preview' | 'unknown'

export interface PositionFix {
  position: LngLat
  /** Metres, 1σ. */
  accuracy: number
  /** Epoch ms the fix was taken. */
  at: number
}

export interface RouteSegment {
  mode: string
  geometry?: LngLat[]
}

export const START_CORRIDOR_METERS: Record<string, number> = {
  walking: 75,
  cycling: 100,
  driving: 150,
  transit: 150,
}
/** Poor accuracy widens the corridor, but only this far. */
const MAX_ACCURACY_ALLOWANCE = 100
export const STALE_FIX_MS = 2 * 60_000
/** Beyond this, guidance won't plan a way onto the route. */
export const JOIN_MAX_METERS = 5_000
const JOINABLE_MODES = new Set(['walking', 'cycling', 'biking', 'driving'])

export function corridorMeters(mode: string, accuracy: number): number {
  const base = START_CORRIDOR_METERS[mode === 'biking' ? 'cycling' : mode] ?? START_CORRIDOR_METERS.driving
  return base + Math.min(Math.max(0, accuracy), MAX_ACCURACY_ALLOWANCE)
}

export interface NearestSegment {
  index: number
  distance: number
}

/** The segment passing closest to `position`, and how far it is. */
export function nearestSegment(segments: RouteSegment[], position: LngLat): NearestSegment | null {
  let best: NearestSegment | null = null
  segments.forEach((segment, index) => {
    const line = (segment.geometry ?? []).map(p => [p.lng, p.lat] as [number, number])
    if (!line.length) return
    const distance = distanceToLine(line, [position.lng, position.lat])
    if (!best || distance < best.distance) best = { index, distance }
  })
  return best
}

/** Within the corridor of any segment, each sized for its own mode. */
function withinCorridor(segments: RouteSegment[], fix: Pick<PositionFix, 'position' | 'accuracy'>): boolean {
  return segments.some(segment => {
    const near = nearestSegment([segment], fix.position)
    return near != null && near.distance <= corridorMeters(segment.mode, fix.accuracy)
  })
}

export function startEligibility(
  segments: RouteSegment[],
  fix: PositionFix | null,
  nowMs: number,
): StartEligibility {
  if (!fix || nowMs - fix.at > STALE_FIX_MS) return 'unknown'
  if (!segments.some(s => (s.geometry?.length ?? 0) > 0)) return 'unknown'
  return withinCorridor(segments, fix) ? 'navigate' : 'preview'
}

/** What guidance does with a first fix: follow, plan a way onto the route, or wait. */
export type JoinPlan =
  | { kind: 'on-route' }
  | { kind: 'join'; segmentIndex: number }
  | { kind: 'away'; distance: number }

export function joinPlan(segments: RouteSegment[], fix: Pick<PositionFix, 'position' | 'accuracy'>): JoinPlan {
  if (withinCorridor(segments, fix)) return { kind: 'on-route' }
  const near = nearestSegment(segments, fix.position)
  if (!near) return { kind: 'on-route' }
  const joinable = JOINABLE_MODES.has(segments[near.index].mode) && near.distance <= JOIN_MAX_METERS
  return joinable ? { kind: 'join', segmentIndex: near.index } : { kind: 'away', distance: near.distance }
}
