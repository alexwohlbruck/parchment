// One polyline per leg, indexed by distance along it (`s`). Every per-frame
// lookup is a binary search over cumulative distances.

import type { LngLat } from '@/types/map.types'
import type {
  RouteEdgeSegment,
  RouteHazard,
  RouteInstruction,
} from '@/types/directions.types'
import type { DrivingSide, InstructionLanePlan, LaneGeometry, LanePlan } from '@server/types/unified-routing.types'
import { haversineMeters } from '@/lib/geo/geo-line'
import { bearingDeg } from '@/lib/map/movement-interpolation'

export interface NavSegmentInput {
  mode: string
  geometry?: LngLat[]
  instructions?: RouteInstruction[]
  edgeSegments?: RouteEdgeSegment[]
  hazards?: RouteHazard[]
  drivingSide?: DrivingSide
  laneGeometry?: LaneGeometry
  lanePlan?: InstructionLanePlan[]
}

export interface NavStep {
  index: number
  segmentIndex: number
  startDistance: number
  instruction: RouteInstruction
  lanePlan?: LanePlan
}

export interface NavSegment {
  index: number
  mode: string
  startDistance: number
  endDistance: number
}

export interface NavEdge extends RouteEdgeSegment {
  segmentIndex: number
}

export interface NavHazard extends RouteHazard {
  segmentIndex: number
}

/** A polyline indexed by route distance. */
export interface MeasuredLine {
  points: LngLat[]
  /** cumulative[i] = distance along the route at points[i]. */
  cumulative: Float64Array
  length: number
}

export interface NavRoute extends MeasuredLine {
  segments: NavSegment[]
  steps: NavStep[]
  /** Edge attributes rebased onto route distance, sorted by start. */
  edges: NavEdge[]
  /** Hazards rebased onto route distance, sorted by start. */
  hazards: NavHazard[]
  drivingSide: DrivingSide
  /** The route drawn in its lanes, where any segment has them and every driven one does; `cumulative` is route distance. */
  laneLine: MeasuredLine | null
}

export function buildNavRoute(inputs: NavSegmentInput[]): NavRoute {
  const points: LngLat[] = []
  const distances: number[] = []
  const segments: NavSegment[] = []
  const steps: NavStep[] = []
  const edges: NavEdge[] = []
  const hazards: NavHazard[] = []
  const lanePoints: LngLat[] = []
  const laneMeasures: number[] = []
  const hasLanes = (i: NavSegmentInput) => (i.laneGeometry?.coordinates.length ?? 0) >= 2
  // A driven segment without lanes needs the half-lane offset, which a lane line drops.
  const laned = inputs.some(hasLanes) && inputs.every(i => i.mode !== 'driving' || hasLanes(i))
  let offset = 0

  inputs.forEach((input, segmentIndex) => {
    const geometry = (input.geometry ?? []).map(p => ({ lat: p.lat, lng: p.lng }))
    const startDistance = offset
    const firstNew = points.length
    for (const p of geometry) {
      const prev = points[points.length - 1]
      if (prev) {
        const d = haversineMeters(prev.lat, prev.lng, p.lat, p.lng)
        if (d < 0.01) continue
        offset += d
      }
      points.push(p)
      distances.push(offset)
    }
    segments.push({ index: segmentIndex, mode: input.mode, startDistance, endDistance: offset })

    if (laned) {
      const lane = input.laneGeometry
      const from = Math.max(0, firstNew - 1)
      const own = lane
        ? lane.coordinates.map(([lng, lat], i) => ({ p: { lat, lng }, s: startDistance + lane.measures[i] }))
        : points.slice(from).map((p, i) => ({ p, s: distances[from + i] }))
      for (const { p, s } of own) {
        lanePoints.push(p)
        laneMeasures.push(Math.min(offset, Math.max(laneMeasures.at(-1) ?? 0, s)))
      }
    }

    const local = Float64Array.from(distances.slice(Math.max(0, firstNew - 1)))
    const localPoints = points.slice(Math.max(0, firstNew - 1))
    let searchFrom = 0
    ;(input.instructions ?? []).forEach((instruction, k) => {
      const s = locateOnPolyline(localPoints, local, instruction.coordinate, searchFrom)
      searchFrom = s.index
      const plan = input.lanePlan?.find(p => p.instruction === k)
      steps.push({
        index: steps.length,
        segmentIndex,
        startDistance: s.distance,
        instruction,
        ...(plan && { lanePlan: { lanes: plan.lanes } }),
      })
    })

    for (const hazard of input.hazards ?? []) {
      hazards.push({
        ...hazard,
        segmentIndex,
        startDistance: startDistance + hazard.startDistance,
        ...(hazard.endDistance != null && { endDistance: startDistance + hazard.endDistance }),
      })
    }

    for (const edge of input.edgeSegments ?? []) {
      edges.push({
        ...edge,
        segmentIndex,
        startDistance: startDistance + edge.startDistance,
        endDistance: startDistance + edge.endDistance,
      })
    }
  })

  edges.sort((a, b) => a.startDistance - b.startDistance)
  hazards.sort((a, b) => a.startDistance - b.startDistance)
  return {
    points,
    cumulative: Float64Array.from(distances),
    length: offset,
    segments,
    steps,
    edges,
    hazards,
    drivingSide: inputs.find(i => i.drivingSide)?.drivingSide ?? 'right',
    laneLine: laned && lanePoints.length >= 2
      ? { points: lanePoints, cumulative: Float64Array.from(laneMeasures), length: offset }
      : null,
  }
}

/** Index of the polyline segment [i, i+1] containing distance `s`. */
export function segmentIndexAt(route: MeasuredLine, s: number): number {
  const c = route.cumulative
  if (c.length < 2) return 0
  if (s <= c[0]) return 0
  if (s >= c[c.length - 1]) return c.length - 2
  let lo = 0
  let hi = c.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (c[mid] <= s) lo = mid
    else hi = mid
  }
  return lo
}

export function pointAt(route: MeasuredLine, s: number): LngLat {
  const { points, cumulative } = route
  if (points.length === 0) return { lat: 0, lng: 0 }
  if (points.length === 1) return points[0]
  const i = segmentIndexAt(route, s)
  const a = points[i]
  const b = points[i + 1]
  const span = cumulative[i + 1] - cumulative[i]
  const t = span > 0 ? Math.min(1, Math.max(0, (s - cumulative[i]) / span)) : 0
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
}

/** Route distance of the point nearest `target`, searching forward from `fromS`. */
export function distanceAlong(route: MeasuredLine, target: LngLat, fromS = 0): number {
  if (route.points.length === 0) return 0
  return locateOnPolyline(route.points, route.cumulative, target, segmentIndexAt(route, fromS)).distance
}

/** Bearing of the polyline segment under `s`. */
export function bearingAt(route: MeasuredLine, s: number): number {
  const { points } = route
  if (points.length < 2) return 0
  const i = segmentIndexAt(route, s)
  return bearingDeg(points[i], points[i + 1])
}

/**
 * Bearing of the chord from `s − window` to `s + window`. Rotates the puck
 * smoothly through corners instead of snapping at each vertex.
 */
export function smoothedBearingAt(route: MeasuredLine, s: number, window: number): number {
  const from = pointAt(route, Math.max(0, s - window))
  const to = pointAt(route, Math.min(route.length, s + window))
  if (from.lat === to.lat && from.lng === to.lng) return bearingAt(route, s)
  return bearingDeg(from, to)
}

function lastIndexAtOrBefore<T extends { startDistance: number }>(items: T[], s: number): number {
  let lo = 0
  let hi = items.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (items[mid].startDistance <= s) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/** The step being travelled at `s` (the last maneuver passed). */
export function stepIndexAt(route: NavRoute, s: number): number {
  return Math.max(0, lastIndexAtOrBefore(route.steps, s))
}

export function edgeAt(route: NavRoute, s: number): NavEdge | null {
  const i = lastIndexAtOrBefore(route.edges, s)
  if (i < 0) return null
  const edge = route.edges[i]
  return s <= edge.endDistance ? edge : null
}

export function segmentAt(route: NavRoute, s: number): NavSegment | null {
  const i = lastIndexAtOrBefore(route.segments, s)
  return i < 0 ? route.segments[0] ?? null : route.segments[i]
}

/**
 * Distance along `points` of the vertex or projection nearest `target`,
 * scanning forward from `fromIndex` so repeated points on loops resolve to
 * the next occurrence rather than the first.
 */
function locateOnPolyline(
  points: LngLat[],
  cumulative: Float64Array,
  target: LngLat,
  fromIndex: number,
): { index: number; distance: number } {
  let best = { index: fromIndex, distance: cumulative[fromIndex] ?? 0, d2: Infinity }
  const cosLat = Math.cos((target.lat * Math.PI) / 180)
  for (let i = fromIndex; i < points.length - 1; i++) {
    const proj = projectOntoSegment(points[i], points[i + 1], target, cosLat)
    if (proj.d2 < best.d2 - 1e-12) {
      best = {
        index: i,
        distance: cumulative[i] + (cumulative[i + 1] - cumulative[i]) * proj.t,
        d2: proj.d2,
      }
      if (proj.d2 < 1e-14) break
    }
  }
  if (points.length === 1) return { index: 0, distance: cumulative[0] ?? 0 }
  return { index: best.index, distance: best.distance }
}

/**
 * Equirectangular projection of `p` onto segment ab. `d2` is in squared
 * degrees-of-latitude; callers compare it, they don't convert it.
 */
export function projectOntoSegment(
  a: LngLat,
  b: LngLat,
  p: LngLat,
  cosLat: number,
): { t: number; d2: number } {
  const ax = a.lng * cosLat
  const bx = b.lng * cosLat
  const px = p.lng * cosLat
  const dx = bx - ax
  const dy = b.lat - a.lat
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (p.lat - a.lat) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const ex = ax + dx * t - px
  const ey = a.lat + dy * t - p.lat
  return { t, d2: ex * ex + ey * ey }
}

/** The route from `s` to its end, thinned to at most `maxPoints`. */
export function routeAhead(route: NavRoute, s: number, maxPoints = 500): LngLat[] {
  const first = segmentIndexAt(route, s) + 1
  const rest = route.points.slice(first)
  const stride = Math.max(1, Math.ceil(rest.length / (maxPoints - 2)))
  const thinned = rest.filter((_, i) => i % stride === 0)
  const last = route.points.at(-1)
  if (last && thinned.at(-1) !== last) thinned.push(last)
  return [pointAt(route, s), ...thinned]
}
