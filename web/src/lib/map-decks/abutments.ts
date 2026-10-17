/**
 * Abutments: where a deck leaves the ground, a wall across it from the slab's
 * underside down into the ground, flush with its edges, and the gap between the
 * slab and the ground closed along each side back to the end, so the deck reads
 * as carried on an embankment rather than floating off it.
 */
import { along, quad, SLAB, sideAt, type Chain, type Mesh, type Point } from './decks'

/** Clearance under the slab at which the wall stands, the farthest from the end it may stand, its thickness, and how far it and the sides reach into the ground, in metres. */
export const ABUTMENT = { clearance: 1.2, reach: 30, thick: 0.6, sink: 0.5 }

/** How far from its end a deck's sides are tested clear of the ground's roads, in metres. */
const CLEAR_OF_END = 2

type Frame = { origin: Point; metresPerUnit: number; color: number[]; out: Mesh }

/**
 * The abutments of a deck's grounded ends, where `clear` allows the ground
 * they cover: an abutment standing on a road, railway or path is left out.
 * Heights as drawn; positions relative to `frame.origin`.
 */
export function abutmentMesh(chain: Chain, z: number[], groundAt: number[], frame: Frame, clear: (footprint: Point[]) => boolean, exaggeration = 1) {
  const n = chain.points.length
  if (n < 2 || chain.kind !== 'road') return
  const { origin, metresPerUnit, color, out } = frame
  const d = along(chain.points)
  const at = (q: Point, metres: number) => [q[0] - origin[0], q[1] - origin[1], metres / metresPerUnit]
  const off = (q: Point, dir: Point, metres: number): Point => [q[0] + (dir[0] * metres) / metresPerUnit, q[1] + (dir[1] * metres) / metresPerUnit]
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
  const under = (k: number) => z[k] - SLAB * exaggeration - groundAt[k]
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
    const top = z[j] + (z[i] - z[j]) * t - SLAB * exaggeration
    const floor = groundAt[j] + (groundAt[i] - groundAt[j]) * t - ABUTMENT.sink * exaggeration
    const behind = order.slice(0, at0).reverse()
    const sides = behind.map(k => edges(k))
    // The road on the ground carries on from the end itself, so the sides are only tested clear of it.
    const footprint = [wl, wr, off(wl, back, ABUTMENT.thick), off(wr, back, ABUTMENT.thick), ...sides.filter((_, m) => Math.abs(d[behind[m]] - d[order[0]]) >= CLEAR_OF_END).flat()]
    if (!clear(footprint)) continue
    const [bl, br] = [off(wl, back, ABUTMENT.thick), off(wr, back, ABUTMENT.thick)]
    // The wall's face toward the span and its back, each wound to face out.
    const face = (a: Point, b: Point, outward: Point) => {
      const cross = (b[0] - a[0]) * outward[1] - (b[1] - a[1]) * outward[0]
      const [p, q] = cross > 0 ? [b, a] : [a, b]
      quad(out, at(p, floor), at(q, floor), at(q, top), at(p, top), color)
    }
    face(wl, wr, [-back[0], -back[1]])
    face(bl, br, back)
    // The sides between the wall and the end, from the slab's underside down into the ground.
    const rail = [{ k: -1, l: wl, r: wr, top, floor }, ...behind.map((k, m) => { const floor = groundAt[k] - ABUTMENT.sink * exaggeration; return { k, l: sides[m][0], r: sides[m][1], top: Math.max(floor, z[k] - SLAB * exaggeration), floor } })]
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
