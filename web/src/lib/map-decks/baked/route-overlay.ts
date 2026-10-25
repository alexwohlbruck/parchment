import { atHit, boundsOf, clip, densify, metresPerUnit, onOwnDeck, unmercator, vertex, type DeckSurface, type Mesh, type Point } from '../decks'
import type { RouteMeasure } from '../deck.types'

export interface RouteLine {
  points: Point[]
  measure?: RouteMeasure | null
}

/** Searched on from a little behind the last point, so a line that doubles back on itself still finds its way. */
const MEASURE_SLACK_METRES = 30

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

export function routeOverlay(mesh: Mesh, lines: RouteLine[], surfaces: DeckSurface[], origin: Point) {
  if (!surfaces.length) return
  const bounds = boundsOf(surfaces.flatMap(surface => surface.points), Math.max(...surfaces.map(surface => surface.width)))
  const runs = lines.flatMap(line => clip(line.points, bounds).map(run => ({ points: densify(run, 3), measure: line.measure })))
  const dense = runs.map(run => run.points)
  const { under } = onOwnDeck(dense, [], surfaces, { centred: true })
  for (const [k, line] of dense.entries()) {
    const along = measured(line, runs[k].measure)
    for (const [width, lift, material] of [[4.4, 0.06, 16], [3, 0.08, 15]]) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i]
        const ha = under.lines[k][i - 1], hb = under.lines[k][i]
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
}
