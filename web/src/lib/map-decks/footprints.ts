import { unproject } from '@/lib/map-objects/object-layer'
import { metresPerUnit, type Point } from './decks'

/** Metres a deck's footprint reaches past its widest edge and its ends, so a way drawn off its centreline still lies inside. */
const SLACK = 2

/** The ground each deck covers, one polygon a deck, for a `within` filter. */
export function deckFootprints(chains: Array<{ points: Point[]; edges: number[] }>): GeoJSON.MultiPolygon {
  const coordinates = chains.flatMap(({ points, edges }) => {
    if (points.length < 2) return []
    const reach = (Math.max(...edges) + SLACK) / metresPerUnit(points[0][1])
    const unit = (a: Point, b: Point): Point => {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      return [((b[0] - a[0]) / length) * reach, ((b[1] - a[1]) / length) * reach]
    }
    const [head, tail] = [unit(points[1], points[0]), unit(points.at(-2)!, points.at(-1)!)]
    const line: Point[] = [[points[0][0] + head[0], points[0][1] + head[1]], ...points, [points.at(-1)![0] + tail[0], points.at(-1)![1] + tail[1]]]
    const across = line.map((_, i) => {
      const [dx, dy] = unit(line[Math.max(0, i - 1)], line[Math.min(line.length - 1, i + 1)])
      return [-dy, dx]
    })
    const left = line.map((p, i) => unproject(p[0] + across[i][0], p[1] + across[i][1]))
    const right = line.map((p, i) => unproject(p[0] - across[i][0], p[1] - across[i][1])).reverse()
    return [[[...left, ...right, left[0]]]]
  })
  return { type: 'MultiPolygon', coordinates }
}
