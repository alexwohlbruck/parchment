// Paint for the navigated route: one source, colour by mode per segment, the
// travelled part greyed. Rebuilt a few times a second, never per frame.

import type { LngLat } from '@/types/map.types'
import { pointAt, smoothedBearingAt, type NavRoute } from './nav-route'
import { projectLatLng } from '@/lib/map/movement-interpolation'

export type Expression = (string | number | Expression)[]

export function routeGradient(
  route: NavRoute,
  travelled: number,
  colorFor: (mode: string) => string,
  travelledColor: string,
): Expression {
  const length = Math.max(1, route.length)
  const progress = (d: number) => Math.min(1, Math.max(0, d / length))
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
  return expression
}

/** The stretch of route through a maneuver plus an arrowhead at its exit. */
export function maneuverArrow(
  route: NavRoute,
  at: number,
  before = 25,
  after = 20,
): { shaft: LngLat[]; head: LngLat[] } {
  const from = Math.max(0, at - before)
  const to = Math.min(route.length, at + after)
  const shaft: LngLat[] = []
  const step = 2
  for (let d = from; d < to; d += step) shaft.push(pointAt(route, d))
  shaft.push(pointAt(route, to))
  const tip = pointAt(route, to)
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
