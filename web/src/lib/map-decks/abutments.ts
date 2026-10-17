/** Abutments: a wall flush with the deck where it leaves the ground, its sides closed down to the ground back to the end. */
import { along, BOX_MIN, metresPerUnit, quad, SLAB, sideAt, type Chain, type Mesh, type Point } from './decks'

/** Clearance under the slab at which the wall stands, the farthest from the end it may stand, its thickness, and how far it and the sides reach into the ground, in metres. */
export const ABUTMENT = { clearance: 1.2, reach: 30, thick: 0.6, sink: 0.5 }

/** How far from its end a deck's sides are tested clear of the ground's roads, and the spacing of the points tested, in metres. */
const CLEAR_OF_END = 2
const PROBE = 1

type Frame = { origin: Point; color: number[]; out: Mesh }

/** The abutment at each grounded end whose footprint `clear` allows; heights as drawn, positions relative to `frame.origin`. */
export function abutmentMesh(chain: Chain, z: number[], groundAt: number[], frame: Frame, clear: (end: 0 | 1, footprint: Point[]) => boolean, exaggeration = 1) {
  const n = chain.points.length
  if (n < 2 || chain.kind !== 'road') return
  const { origin, color, out } = frame
  const scale = metresPerUnit(chain.points[Math.floor(n / 2)][1])
  const d = along(chain.points)
  const at = (q: Point, metres: number) => [q[0] - origin[0], q[1] - origin[1], metres / scale]
  const off = (q: Point, dir: Point, metres: number): Point => [q[0] + (dir[0] * metres) / scale, q[1] + (dir[1] * metres) / scale]
  const leftOf = (i: number): Point => {
    const [a, b] = [chain.points[Math.max(0, i - 1)], chain.points[Math.min(n - 1, i + 1)]]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len]
  }
  const edges = (i: number, t = 0): [Point, Point] => {
    const j = Math.min(n - 1, i + (t > 0 ? 1 : 0))
    const p: Point = [chain.points[i][0] + (chain.points[j][0] - chain.points[i][0]) * t, chain.points[i][1] + (chain.points[j][1] - chain.points[i][1]) * t]
    const left = leftOf(i)
    return [off(p, left, sideAt(chain, 0, i, t)), off(p, left, -sideAt(chain, 1, i, t))]
  }
  const under = (k: number) => z[k] - SLAB - groundAt[k]
  for (const end of [0, 1] as const) {
    if (!chain.grounded[end]) continue
    const order = end ? [...Array(n).keys()].reverse() : [...Array(n).keys()]
    const at0 = order.findIndex(k => Math.abs(d[k] - d[order[0]]) <= ABUTMENT.reach && under(k) >= ABUTMENT.clearance * exaggeration)
    if (at0 <= 0 || at0 === n - 1) continue
    const [i, j] = [order[at0], order[at0 - 1]]
    const t = (ABUTMENT.clearance * exaggeration - under(j)) / (under(i) - under(j) || 1)
    const lo = Math.min(i, j)
    const tAt = i > j ? t : 1 - t
    const [wl, wr] = edges(lo, tAt)
    const back: Point = (() => {
      const [a, b] = [chain.points[i], chain.points[j]]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      return [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
    })()
    const top = z[j] + (z[i] - z[j]) * t - SLAB
    const floor = groundAt[j] + (groundAt[i] - groundAt[j]) * t - ABUTMENT.sink * exaggeration
    const behind = order.slice(0, at0).reverse()
    const sides = behind.map(k => edges(k))
    const [bl, br] = [off(wl, back, ABUTMENT.thick), off(wr, back, ABUTMENT.thick)]
    // Clear of what it stands on, but for the road carrying on from the end itself.
    const kept = sides.filter((_, m) => Math.abs(d[behind[m]] - d[order[0]]) >= CLEAR_OF_END)
    const lines = [[wl, wr], [bl, br], [wl, ...kept.map(s => s[0])], [wr, ...kept.map(s => s[1])]]
    const footprint = lines.flatMap(line => line.slice(1).flatMap((q, m) => sampled(line[m], q)))
    if (!clear(end, footprint)) continue
    const face = (a: Point, b: Point, outward: Point) => {
      const cross = (b[0] - a[0]) * outward[1] - (b[1] - a[1]) * outward[0]
      const [p, q] = cross > 0 ? [b, a] : [a, b]
      quad(out, at(p, floor), at(q, floor), at(q, top), at(p, top), color)
    }
    face(wl, wr, [-back[0], -back[1]])
    face(bl, br, back)
    // Up to the slab's underside, or to the road itself where the deck is too low to have a slab.
    const rail = [{ k: -1, l: wl, r: wr, top, floor }, ...behind.map((k, m) => {
      const floor = groundAt[k] - ABUTMENT.sink * exaggeration
      return { k, l: sides[m][0], r: sides[m][1], top: Math.max(floor, z[k] - (z[k] - groundAt[k] >= BOX_MIN ? SLAB : 0)), floor }
    })]
    for (let m = 1; m < rail.length; m++) {
      const [u, v] = [rail[m - 1], rail[m]]
      if (u.top === u.floor && v.top === v.floor) continue
      for (const side of ['l', 'r'] as const) {
        const outward = side === 'l' ? leftOf(Math.max(0, v.k)) : (([x, y]) => [-x, -y] as Point)(leftOf(Math.max(0, v.k)))
        const [a, b] = [u[side], v[side]]
        const cross = (b[0] - a[0]) * outward[1] - (b[1] - a[1]) * outward[0]
        const [p, q, pt, qt, pf, qf] = cross > 0 ? [b, a, v.top, u.top, v.floor, u.floor] : [a, b, u.top, v.top, u.floor, v.floor]
        quad(out, at(p, pf), at(q, qf), at(q, qt), at(p, pt), color)
      }
    }
  }
}

/** Points every PROBE metres from `a` to `b`, both included. */
function sampled(a: Point, b: Point): Point[] {
  const metres = Math.hypot(b[0] - a[0], b[1] - a[1]) * metresPerUnit(a[1])
  const steps = Math.max(1, Math.ceil(metres / PROBE))
  return Array.from({ length: steps + 1 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps] as Point)
}
