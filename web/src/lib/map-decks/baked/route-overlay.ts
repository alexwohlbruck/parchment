import { atHit, boundsOf, clip, densify, metresPerUnit, onOwnDeck, unmercator, vertex, type DeckSurface, type Hit, type Mesh, type Point } from '../decks'
import type { RouteMeasure, RouteSpan } from '../deck.types'

export interface RouteLine {
  points: Point[]
  measure?: RouteMeasure | null
  /** Metres right of its line the route is drawn. */
  offset?: number
  /** Whether the route may ride a deck at a distance along it, for a measured line. */
  rides?: (metres: number) => boolean
}

/** Searched on from a little behind the last point, so a line that doubles back on itself still finds its way. */
const MEASURE_SLACK_METRES = 30
/** How closely a route must run with a deck to ride it rather than pass over or under it, as a cosine. */
const RIDES_ALIGNED = Math.cos((30 * Math.PI) / 180)

/** Metres along its route at each point, or -1 where the line has no measure. */
function measured(points: Point[], measure: RouteMeasure | null | undefined): number[] {
  if (!measure) return points.map(() => -1)
  let from = 0
  return points.map(p => {
    const s = measure(unmercator(p), from)
    from = Math.max(0, s - MEASURE_SLACK_METRES)
    return s
  })
}

/** The line moved `metres` to the right of its direction of travel. */
export function besideLine(points: Point[], metres: number): Point[] {
  if (!metres || points.length < 2) return points
  return points.map((p, i) => {
    const [a, b] = [points[Math.max(0, i - 1)], points[Math.min(points.length - 1, i + 1)]]
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (!length) return p
    const scale = metres / metresPerUnit(p[1]) / length
    // Mercator y runs south, so the right of (dx, dy) is (-dy, dx).
    return [p[0] - (b[1] - a[1]) * scale, p[1] + (b[0] - a[0]) * scale]
  })
}

/** Whether the line from `a` to `b` runs with the deck segment under a hit, either way along it. */
function runsAlong(surface: DeckSurface, hit: Hit, a: Point, b: Point): boolean {
  const [p, q] = [surface.points[hit.segment - 1], surface.points[hit.segment]]
  const dot = (b[0] - a[0]) * (q[0] - p[0]) + (b[1] - a[1]) * (q[1] - p[1])
  return Math.abs(dot) >= RIDES_ALIGNED * Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(q[0] - p[0], q[1] - p[1])
}

/** Lays each route over the decks it rides; returns, per line, the stretches of a measured one laid. */
export function routeOverlay(mesh: Mesh, lines: RouteLine[], surfaces: DeckSurface[], origin: Point): RouteSpan[][] {
  const laid: RouteSpan[][] = lines.map(() => [])
  if (!surfaces.length) return laid
  const bounds = boundsOf(surfaces.flatMap(surface => surface.points), Math.max(...surfaces.map(surface => surface.width)))
  const runs = lines.flatMap((line, l) => clip(line.points, bounds).map(run => ({ points: besideLine(densify(run, 3), line.offset ?? 0), line: l })))
  const dense = runs.map(run => run.points)
  const { under } = onOwnDeck(dense, [], surfaces, { centred: true })
  for (const [k, line] of dense.entries()) {
    const { measure, rides } = lines[runs[k].line]
    const along = measured(line, measure)
    const hits = line.map((_, i) => {
      const hit = under.lines[k][i]
      if (!hit || (rides && along[i] >= 0 && !rides(along[i]))) return null
      return runsAlong(surfaces[hit.deck], hit, line[Math.max(0, i - 1)], line[Math.min(line.length - 1, i + 1)]) ? hit : null
    })
    let span: RouteSpan | null = null
    for (let i = 1; i < line.length; i++) {
      if (!hits[i - 1] || !hits[i] || along[i - 1] < 0 || along[i] < 0) span = null
      else if (span) span[1] = Math.max(span[1], along[i])
      else laid[runs[k].line].push((span = [Math.min(along[i - 1], along[i]), Math.max(along[i - 1], along[i])]))
    }
    for (const [width, lift, material] of [[4.4, 0.06, 16], [3, 0.08, 15]]) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i]
        const ha = hits[i - 1], hb = hits[i]
        const length = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (!ha || !hb || !length) continue
        const scale = 1 / metresPerUnit(a[1])
        const nx = -(b[1] - a[1]) / length * scale, ny = (b[0] - a[0]) / length * scale
        const corners = [[a, ha, 1, along[i - 1]], [a, ha, -1, along[i - 1]], [b, hb, -1, along[i]], [b, hb, 1, along[i]]] as const
        for (const j of [0, 1, 2, 0, 2, 3]) {
          const [p, hit, side, s] = corners[j]
          const color = [material, s, 0]
          vertex(mesh, [p[0] + nx * side * width / 2 - origin[0], p[1] + ny * side * width / 2 - origin[1], (hit.z + lift) * scale],
            [0, 0, 1], color, color, atHit(surfaces[hit.deck].bias, hit), [nx * side, ny * side, width / 2])
          mesh.lift?.push((surfaces[hit.deck].lift ? atHit(surfaces[hit.deck].lift, hit) : hit.z + lift) * scale)
        }
      }
    }
  }
  return laid
}
