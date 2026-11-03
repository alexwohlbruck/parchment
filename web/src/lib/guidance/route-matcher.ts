// Searches only a window of route distance, so a parallel road or a loop's
// other pass can't win by being geometrically closer.

import type { LngLat } from '@/types/map.types'
import { distanceMeters, bearingDeg } from '@/lib/map/movement-interpolation'
import { projectOntoSegment, segmentIndexAt, type NavRoute } from './nav-route'
import { angleDelta } from './spring'

export interface RouteMatch {
  /** Distance along the route of the matched point. */
  s: number
  point: LngLat
  /** Perpendicular distance from the fix to the route, metres. */
  offset: number
  /** Route bearing at the match. */
  bearing: number
  /** Fix course minus route bearing, when the fix had a usable course. */
  courseError: number | null
}

export interface MatchOptions {
  /** Search window in route distance. Omit for a whole-route search. */
  window?: { from: number; to: number }
  /** Fix course over ground, degrees; ignored when null. */
  course?: number | null
  /** Metres-equivalent cost per degree of course error. */
  courseWeight?: number
  /** Expected position error, metres; scales the distance term. */
  sigma?: number
}

const DEFAULT_COURSE_WEIGHT = 0.6

export function matchToRoute(
  route: NavRoute,
  fix: LngLat,
  options: MatchOptions = {},
): RouteMatch | null {
  const { points, cumulative } = route
  if (points.length < 2) return null

  const from = options.window ? segmentIndexAt(route, Math.max(0, options.window.from)) : 0
  const to = options.window
    ? segmentIndexAt(route, Math.min(route.length, options.window.to))
    : points.length - 2
  const sigma = Math.max(3, options.sigma ?? 5)
  const course = options.course ?? null
  const courseWeight = options.courseWeight ?? DEFAULT_COURSE_WEIGHT
  const cosLat = Math.cos((fix.lat * Math.PI) / 180)

  let best: (RouteMatch & { cost: number }) | null = null
  for (let i = from; i <= to; i++) {
    const a = points[i]
    const b = points[i + 1]
    const { t } = projectOntoSegment(a, b, fix, cosLat)
    const point = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
    const offset = distanceMeters(fix, point)
    const bearing = bearingDeg(a, b)
    const courseError = course == null ? null : angleDelta(bearing, course)
    const courseCost = courseError == null ? 0 : (Math.abs(courseError) * courseWeight) / sigma
    const cost = (offset / sigma) ** 2 + courseCost ** 2
    if (!best || cost < best.cost) {
      best = {
        s: cumulative[i] + (cumulative[i + 1] - cumulative[i]) * t,
        point,
        offset,
        bearing,
        courseError,
        cost,
      }
    }
  }
  if (!best) return null
  const { cost: _cost, ...match } = best
  return match
}
