/**
 * Where a deck meets the ground: the terrain cut down wherever it would poke
 * through a deck's end, the road beyond eased up to meet a deck that ends over
 * the ground, and an abutment with wing walls where the deck leaves the ground.
 */
import { along, FOOTING, quad, SLAB, sideAt, type Chain, type Mesh, type Point } from './decks'
import { footprint, type Footprint } from '@/lib/map-terrain/carve'

/** How high over the ground a deck may stand and still have the ground under it cut to it, and how far along from its end that may run, in metres. */
export const EMBANK = { over: 2.5, reach: 30 }
/** How far below a deck's top the ground is brought, so the deck is drawn over it; how far past its edges the ground runs level; and how far out it banks to meet the ground. */
const SINK = 0.05
const SHOULDER = 0.3
const BANK_OUT = 6
/** How far the ground is moulded on along the road beyond a deck's end. */
const APPROACH = 3

/** The ground at each grounded end of the decks, as footprints cutting it down to just under the deck, keyed so an unchanged deck keeps its own. Heights in true metres. */
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
      out.set(`${key}|${end}`, footprint(points, floor, [floor, floor], inner, shoulder, outer, false))
    }
  }
  return out
}

/** How far the road beyond a deck's end eases up to it, in metres, and the least rise worth easing. */
export const APPROACH_SLAB = { length: 30, least: 0.1 }

/** A road beyond a deck's end that eases up to meet it: the end, its outward direction (mercator, unit), its half width in metres and the rise to the deck there. */
export type Approach = { p: Point; out: Point; half: number; rise: number }

/** The height over the ground the road stands at a point, eased by a smooth vertical curve from each deck end's rise down to none; 0 away from every approach. */
export function approachLift(approaches: Approach[], q: Point, metresPerUnit: number): number {
  let lift = 0
  for (const { p, out, half, rise } of approaches) {
    const [dx, dy] = [(q[0] - p[0]) * metresPerUnit, (q[1] - p[1]) * metresPerUnit]
    const along = dx * out[0] + dy * out[1]
    const across = Math.abs(-dx * out[1] + dy * out[0])
    if (along < -1 || along > APPROACH_SLAB.length || across > half + 0.5) continue
    const u = 1 - Math.max(0, along) / APPROACH_SLAB.length
    lift = Math.max(lift, rise * u * u * (3 - 2 * u))
  }
  return lift
}

/** How far below its footing an abutment's wall reaches, so it never stands clear where the ground falls away across the deck. */
const WALL_SINK = 1

/** How thick an abutment's wall is, how far its wing walls splay from square, and the shortest and longest wing, in metres and radians. */
const ABUTMENT = { thick: 0.8, splay: Math.PI / 6, wingMin: 2, wingMax: 10 }

/**
 * Abutments where a deck leaves the ground: at the first sample from each
 * grounded end where it stands clear enough to have a slab, a wall across it
 * from the slab's underside down into the ground, with wing walls splayed back
 * from its corners, their tops falling to the ground. Heights as drawn (the
 * map's metres), positions relative to `origin`.
 */
export function abutmentMesh(chain: Chain, z: number[], groundAt: number[], clearance: number, origin: Point, color: number[], out: Mesh, metresPerUnit: number) {
  const n = chain.points.length
  if (n < 3 || chain.kind !== 'road') return
  for (const end of [0, 1] as const) {
    if (!chain.grounded[end]) continue
    const order = end ? [...Array(n).keys()].reverse() : [...Array(n).keys()]
    const at0 = order.findIndex(k => z[k] - groundAt[k] >= clearance)
    if (at0 <= 0 || at0 === order.length - 1) continue
    // Where the deck crosses the clearance, between the samples either side.
    const [i, j] = [order[at0], order[at0 - 1]]
    const [hi, hj] = [z[i] - groundAt[i], z[j] - groundAt[j]]
    const t = (clearance - hj) / (hi - hj || 1)
    const p: Point = [chain.points[j][0] + (chain.points[i][0] - chain.points[j][0]) * t, chain.points[j][1] + (chain.points[i][1] - chain.points[j][1]) * t]
    const lerp = (v: number[]) => v[j] + (v[i] - v[j]) * t
    const [a, b] = [chain.points[Math.max(0, i - 1)], chain.points[Math.min(n - 1, i + 1)]]
    const fl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const forward: Point = [(b[0] - a[0]) / fl, (b[1] - a[1]) / fl]
    // As deckMesh: left of the chain's own direction, whichever end this is.
    const left: Point = [-forward[1], forward[0]]
    const back: Point = end ? forward : [-forward[0], -forward[1]]
    const [l, r] = [sideAt(chain, 0, i) + 0.3, sideAt(chain, 1, i) + 0.3]
    const top = lerp(z) - SLAB
    const ground = lerp(groundAt)
    const foot = ground - FOOTING - WALL_SINK
    const h = top - ground
    const at = (q: Point, metres: number) => [q[0] - origin[0], q[1] - origin[1], metres / metresPerUnit]
    const off = (q: Point, d: Point, m: number): Point => [q[0] + (d[0] * m) / metresPerUnit, q[1] + (d[1] * m) / metresPerUnit]
    const cornerL = off(p, left, l)
    const cornerR = off(p, left, -r)
    const thick = (q: Point) => off(q, back, -ABUTMENT.thick)
    // The wall: its face toward the span, its back, and its top under the slab.
    const face = (a: Point, b: Point) => quad(out, at(a, foot), at(b, foot), at(b, top), at(a, top), color)
    face(thick(cornerR), thick(cornerL))
    face(cornerL, cornerR)
    quad(out, at(thick(cornerL), top), at(thick(cornerR), top), at(cornerR, top), at(cornerL, top), color)
    // Wing walls back from each corner, splayed out, their tops sloping down to the ground.
    const wing = Math.max(ABUTMENT.wingMin, Math.min(ABUTMENT.wingMax, h * 1.5))
    for (const [corner, side] of [[cornerL, 1], [cornerR, -1]] as const) {
      const dir: Point = [back[0] * Math.cos(ABUTMENT.splay) + left[0] * side * Math.sin(ABUTMENT.splay), back[1] * Math.cos(ABUTMENT.splay) + left[1] * side * Math.sin(ABUTMENT.splay)]
      const tip = off(corner, dir, wing)
      const tipTop = ground + Math.max(0, h - wing / 1.5)
      quad(out, at(corner, foot), at(tip, foot), at(tip, tipTop), at(corner, top), color)
      quad(out, at(tip, foot), at(corner, foot), at(corner, top), at(tip, tipTop), color)
    }
  }
}
