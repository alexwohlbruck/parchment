// Paint for the navigated route: one source, colour by mode per segment, the
// travelled part greyed. Rebuilt a few times a second, never per frame.

import type { LngLat } from '@/types/map.types'
import { pointAt, segmentIndexAt, smoothedBearingAt, type MeasuredLine, type NavRoute, type NavSegment } from './nav-route'
import { haversineMeters } from '@/lib/geo/geo-line'
import { projectLatLng } from '@/lib/map/movement-interpolation'
import { metersPerPixel } from './camera-framing'
import type { RouteSpan } from '@/lib/map-decks/deck.types'

export type Expression = (string | number | Expression)[]

export const TRAVELLED_COLOR = '#9ca3af'
export const TRAVELLED_CASE_COLOR = '#6b7280'
const HIDDEN_COLOR = 'rgba(0, 0, 0, 0)'

export function routeGradient(
  route: NavRoute,
  travelled: number,
  colorFor: (segment: NavSegment) => string,
  travelledColor: string,
  /** Where route distance `d` falls along the drawn line, 0 to 1; by default the route itself. */
  progressAt?: (d: number) => number,
  /** Stretches of route distance left undrawn, as where the route is laid over a bridge deck instead. */
  hidden: RouteSpan[] = [],
): Expression {
  const length = Math.max(1, route.length)
  const progress = progressAt ?? ((d: number) => Math.min(1, Math.max(0, d / length)))
  const colorAt = (d: number) => {
    if (hidden.some(([start, end]) => d >= start && d < end)) return HIDDEN_COLOR
    if (d < travelled) return travelledColor
    const segment = route.segments.find(s => d < s.endDistance) ?? route.segments.at(-1)
    return segment ? colorFor(segment) : travelledColor
  }
  const breaks = [travelled, ...route.segments.map(s => s.startDistance), ...hidden.flat()]
    .filter(d => d > 0 && d < route.length)
    .sort((a, b) => a - b)

  // `step` needs strictly ascending stops: a stop landing on its predecessor replaces it.
  const expression: Expression = ['step', ['line-progress'], colorAt(0)]
  let last = 0
  for (const d of breaks) {
    const at = progress(d)
    const color = colorAt(d)
    if (color === expression[expression.length - 1]) continue
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

/** Half a lane: a driven route without lane geometry runs in its lanes, not on the road's centre line. */
const HALF_LANE_METERS = 1.8

/** What is drawn: the route in its lanes where it has them, else its centreline. */
export function drawnLine(route: NavRoute): MeasuredLine {
  return route.laneLine ?? route
}

/**
 * Metres right of the drawn line the route is shown: none on a lane line, which is
 * in its lanes already, and none off the road, as walking and cycling keep to paths.
 */
export function drawnOffsetMeters(route: NavRoute): number {
  if (route.laneLine) return 0
  if (route.segments.length === 0 || route.segments.some(s => s.mode !== 'driving')) return 0
  return route.drivingSide === 'left' ? -HALF_LANE_METERS : HALF_LANE_METERS
}

/** Where the route is shown at route distance `s`, so the puck rides the line drawn for it. */
export function drawnPoint(route: NavRoute, s: number): LngLat {
  return pointBeside(drawnLine(route), s, drawnOffsetMeters(route))
}

/** The route's point at `at`, moved `offset` metres to its right to sit on an offset route line. */
export function pointBeside(route: MeasuredLine, at: number, offset = 0): LngLat {
  const p = pointAt(route, at)
  return offset ? projectLatLng(p, offset, smoothedBearingAt(route, at, 3) + 90, 1) : p
}

/** The route's offset from the road's centre to the middle of its travel lanes, as zoom-scaled pixels. */
export function laneOffset(metres: number, lat: number): Expression {
  const at = (zoom: number) => metres / metersPerPixel(zoom, lat)
  return ['interpolate', ['exponential', 2], ['zoom'], 10, at(10), 22, at(22)]
}
