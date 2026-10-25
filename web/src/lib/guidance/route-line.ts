// Paint for the navigated route: one source, colour by mode per segment, the
// travelled part greyed. Rebuilt a few times a second, never per frame.

import type { LngLat } from '@/types/map.types'
import { pointAt, segmentIndexAt, smoothedBearingAt, type MeasuredLine, type NavRoute } from './nav-route'
import { haversineMeters } from '@/lib/geo/geo-line'
import { projectLatLng } from '@/lib/map/movement-interpolation'
import { metersPerPixel } from './camera-framing'

export type Expression = (string | number | Expression)[]

export function routeGradient(
  route: NavRoute,
  travelled: number,
  colorFor: (mode: string) => string,
  travelledColor: string,
  /** Where route distance `d` falls along the drawn line, 0 to 1; by default the route itself. */
  progressAt?: (d: number) => number,
): Expression {
  const length = Math.max(1, route.length)
  const progress = progressAt ?? ((d: number) => Math.min(1, Math.max(0, d / length)))
  const cut = progress(travelled)
  const stops: [at: number, color: string][] = cut > 0 ? [[0, travelledColor]] : []
  for (const segment of route.segments) {
    if (progress(segment.endDistance) <= cut) continue
    stops.push([Math.max(cut, progress(segment.startDistance)), colorFor(segment.mode)])
  }
  if (stops.length === 0) stops.push([0, travelledColor])

  // `step` needs strictly ascending stops: a stop landing on its predecessor replaces it.
  const expression: Expression = ['step', ['line-progress'], stops[0][1]]
  let last = 0
  for (const [at, color] of stops.slice(1)) {
    if (at <= last) expression[expression.length - 1] = color
    else {
      expression.push(at, color)
      last = at
    }
  }
  // MapLibre rejects a `step` without at least one stop.
  if (expression.length === 3) expression.push(1, expression[2])
  return expression
}

/**
 * Route distance to `line-progress` along a line drawn apart from the route,
 * such as its lane line, whose own length differs from the route's.
 */
export function drawnProgress(line: MeasuredLine): (d: number) => number {
  const drawn = new Float64Array(line.points.length)
  for (let i = 1; i < line.points.length; i++) {
    const a = line.points[i - 1]
    const b = line.points[i]
    drawn[i] = drawn[i - 1] + haversineMeters(a.lat, a.lng, b.lat, b.lng)
  }
  const total = Math.max(1e-6, drawn[drawn.length - 1] ?? 0)
  return d => {
    if (line.points.length < 2) return 0
    const i = segmentIndexAt(line, d)
    const span = line.cumulative[i + 1] - line.cumulative[i]
    const t = span > 0 ? Math.min(1, Math.max(0, (d - line.cumulative[i]) / span)) : d >= line.cumulative[i + 1] ? 1 : 0
    return Math.min(1, Math.max(0, (drawn[i] + (drawn[i + 1] - drawn[i]) * t) / total))
  }
}

/** The stretch of route through a maneuver plus an arrowhead at its exit. */
export function maneuverArrow(
  route: MeasuredLine,
  at: number,
  before = 25,
  after = 20,
  /** Metres to the right of the route, to sit on an offset route line. */
  offset = 0,
): { shaft: LngLat[]; head: LngLat[] } {
  const from = Math.max(0, at - before)
  const to = Math.min(route.length, at + after)
  const beside = (d: number) => {
    const p = pointAt(route, d)
    return offset ? projectLatLng(p, offset, smoothedBearingAt(route, d, 3) + 90, 1) : p
  }
  const shaft: LngLat[] = []
  const step = 2
  for (let d = from; d < to; d += step) shaft.push(beside(d))
  shaft.push(beside(to))
  const tip = beside(to)
  const bearing = smoothedBearingAt(route, to, 3)
  const back = projectLatLng(tip, 7, bearing + 180, 1)
  return {
    shaft,
    head: [
      projectLatLng(tip, 4, bearing, 1),
      projectLatLng(back, 5, bearing - 90, 1),
      projectLatLng(back, 5, bearing + 90, 1),
      projectLatLng(tip, 4, bearing, 1),
    ],
  }
}

/** The route's offset from the road's centre to the middle of its travel lanes, as zoom-scaled pixels. */
export function laneOffset(metres: number, lat: number): Expression {
  const at = (zoom: number) => metres / metersPerPixel(zoom, lat)
  return ['interpolate', ['exponential', 2], ['zoom'], 10, at(10), 22, at(22)]
}
