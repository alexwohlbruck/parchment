/**
 * The ground moulded to meet each deck where it lands: raised to the deck's
 * top as an embankment where the deck stands a little over it, and cut down
 * where it pokes through, banking out to the ground around on either side.
 */
import { along, sideAt, type Chain, type Point } from './decks'
import { footprint, type Footprint } from '@/lib/map-terrain/carve'

/** How high over the ground a deck may stand and still be met by an embankment, and how far along from its end that may run, in metres. */
export const EMBANK = { over: 2.5, reach: 30 }
/** How far below a deck's top the ground is brought, so the deck is drawn over it; how far past its edges the ground runs level; and how far out it banks to meet the ground. */
const SINK = 0.05
const SHOULDER = 0.3
const BANK_OUT = 6
/** How far the ground is moulded on along the road beyond a deck's end. */
const APPROACH = 3

/** The ground at each grounded end of the decks, as footprints to raise and to cut it, keyed so an unchanged deck keeps its own. Heights in true metres. */
export function abutments(decks: Array<{ key: string; chain: Chain; z: number[]; groundAt: number[] }>): Map<string, Footprint> {
  const out = new Map<string, Footprint>()
  for (const { key, chain, z, groundAt } of decks) {
    const n = chain.points.length
    if (n < 2) continue
    const d = along(chain.points)
    for (const end of [0, 1] as const) {
      if (!chain.grounded[end]) continue
      const order = end ? [...Array(n).keys()].reverse() : [...Array(n).keys()]
      const run: number[] = []
      for (const i of order) {
        if (Math.abs(d[i] - d[order[0]]) > EMBANK.reach || z[i] - groundAt[i] > EMBANK.over) break
        run.push(i)
      }
      if (run.length < 2) continue
      const [first, next] = [chain.points[run[0]], chain.points[run[1]]]
      const len = Math.hypot(first[0] - next[0], first[1] - next[1]) || 1
      const metre = len / Math.abs(d[run[0]] - d[run[1]] || 1)
      const beyond: Point = [first[0] + ((first[0] - next[0]) / len) * metre * APPROACH, first[1] + ((first[1] - next[1]) / len) * metre * APPROACH]
      const points = [beyond, ...run.map(i => chain.points[i])]
      const floor = [z[run[0]] - SINK, ...run.map(i => z[i] - SINK)]
      // Sides as seen walking in from the end: reversed for the far end.
      const sides = end ? [1, 0] as const : [0, 1] as const
      const inner: [number, number] = [sideAt(chain, sides[0], run[0]), sideAt(chain, sides[1], run[0])]
      const shoulder: [number, number] = [inner[0] + SHOULDER, inner[1] + SHOULDER]
      const outer: [number, number] = [shoulder[0] + BANK_OUT, shoulder[1] + BANK_OUT]
      for (const fill of [true, false])
        out.set(`${key}|${end}|${fill}`, footprint(points, floor, [floor, floor], inner, shoulder, outer, fill))
    }
  }
  return out
}
