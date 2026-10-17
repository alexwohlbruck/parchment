/**
 * Where a deck meets the ground: the terrain cut down wherever it would poke
 * through a deck's end, the road beyond eased up to meet a deck that ends over
 * the ground, and an abutment with wing walls where the deck leaves the ground.
 */
import { along, FOOTING, SLAB, sideAt, TOUCHDOWN, vertex, type Chain, type Mesh, type Point } from './decks'
import { footprint, type Footprint } from '@/lib/map-terrain/carve'

/** How high over the ground a deck may stand and still have the ground under it cut to it, and how far along from its end that may run, in metres. */
export const CUT = { over: 2.5, reach: 30 }
/** How far below a deck's top the ground is brought, so the deck is drawn over it; how far past its edges the ground runs level; and how far out it banks to meet the ground. */
const SINK = 0.05
const SHOULDER = 0.3
const BANK_OUT = 6
/** How far the cut runs on along the road beyond a deck's end. */
const RUN_ON = 3

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
        if (Math.abs(d[i] - d[order[0]]) > CUT.reach || z[i] - groundAt[i] > CUT.over) break
        run.push(i)
      }
      if (run.length < 2) continue
      const [first, next] = [chain.points[run[0]], chain.points[run[1]]]
      const len = Math.hypot(first[0] - next[0], first[1] - next[1]) || 1
      const metre = len / Math.abs(d[run[0]] - d[run[1]] || 1)
      const beyond: Point = [first[0] + ((first[0] - next[0]) / len) * metre * RUN_ON, first[1] + ((first[1] - next[1]) / len) * metre * RUN_ON]
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

/** How thick an abutment's wall and its wing walls are, how far the wings splay from square, and the shortest and longest wing, in metres and radians. */
const ABUTMENT = { thick: 0.8, wingThick: 0.4, splay: Math.PI / 6, wingMin: 2, wingMax: 10 }

/** How thick the walls along a raised approach are, how far past its road they stand, and how far apart its sections are, in metres. */
const APPROACH_WALL = { thick: 0.3, beyond: 0.3, step: 2 }

type Frame = { origin: Point; metresPerUnit: number; color: number[]; out: Mesh }

const offset = (q: Point, d: Point, metres: number, metresPerUnit: number): Point => [q[0] + (d[0] * metres) / metresPerUnit, q[1] + (d[1] * metres) / metresPerUnit]

/** A quad wound so its normal faces `outward`, its vertices drawn `bias` metres toward the eye. */
function facing(out: Mesh, corners: number[][], outward: number[], color: number[], bias = 0) {
  const [a, b, c] = corners
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const flip = n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] < 0
  const [p, q, r, s] = flip ? [...corners].reverse() : corners
  const l = (Math.hypot(n[0], n[1], n[2]) || 1) * (flip ? -1 : 1)
  for (const k of [p, q, r, p, r, s]) vertex(out, k, [n[0] / l, n[1] / l, n[2] / l], color, color, bias)
}

/**
 * A wall from `a` to `b`, `thick` toward `side` (unit, horizontal): its two
 * faces, its top and its ends, each facing out. Heights as drawn.
 */
function wall({ origin, metresPerUnit, color, out }: Frame, a: Point, b: Point, top: [number, number], foot: [number, number], side: Point, thick: number) {
  const at = (q: Point, metres: number) => [q[0] - origin[0], q[1] - origin[1], metres / metresPerUnit]
  const [a2, b2] = [offset(a, side, thick, metresPerUnit), offset(b, side, thick, metresPerUnit)]
  const along = [b[0] - a[0], b[1] - a[1], 0]
  const away = [-side[0], -side[1], 0]
  facing(out, [at(a, foot[0]), at(b, foot[1]), at(b, top[1]), at(a, top[0])], away, color)
  facing(out, [at(a2, foot[0]), at(b2, foot[1]), at(b2, top[1]), at(a2, top[0])], [side[0], side[1], 0], color)
  facing(out, [at(a, top[0]), at(b, top[1]), at(b2, top[1]), at(a2, top[0])], [0, 0, 1], color)
  facing(out, [at(a, foot[0]), at(a2, foot[0]), at(a2, top[0]), at(a, top[0])], along.map(v => -v), color)
  facing(out, [at(b, foot[1]), at(b2, foot[1]), at(b2, top[1]), at(b, top[1])], along, color)
}

/**
 * Abutments where a deck leaves the ground: where it first stands clear
 * enough from each grounded end to have a slab, a wall across it from the
 * slab's underside down into the ground, with wing walls splayed back from
 * its corners, their tops falling to the ground at their tips. Heights as
 * drawn (the map's metres), positions relative to `origin`; `groundAt` the
 * drawn ground anywhere, null where unknown.
 */
export function abutmentMesh(chain: Chain, z: number[], groundAt: number[], clearance: number, frame: Frame, ground: (q: Point) => number | null = () => null) {
  const n = chain.points.length
  if (n < 3 || chain.kind !== 'road') return
  const { metresPerUnit } = frame
  for (const end of [0, 1] as const) {
    if (!chain.grounded[end]) continue
    const order = end ? [...Array(n).keys()].reverse() : [...Array(n).keys()]
    const at0 = order.findIndex(k => z[k] - groundAt[k] >= clearance)
    if (at0 <= 0 || at0 === order.length - 1) continue
    const [i, j] = [order[at0], order[at0 - 1]]
    const [hi, hj] = [z[i] - groundAt[i], z[j] - groundAt[j]]
    const t = (clearance - hj) / (hi - hj || 1)
    const p: Point = [chain.points[j][0] + (chain.points[i][0] - chain.points[j][0]) * t, chain.points[j][1] + (chain.points[i][1] - chain.points[j][1]) * t]
    const lerp = (v: number[]) => v[j] + (v[i] - v[j]) * t
    const [a, b] = [chain.points[Math.max(0, i - 1)], chain.points[Math.min(n - 1, i + 1)]]
    const fl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const forward: Point = [(b[0] - a[0]) / fl, (b[1] - a[1]) / fl]
    const left: Point = [-forward[1], forward[0]]
    const back: Point = end ? forward : [-forward[0], -forward[1]]
    const span: Point = [-back[0], -back[1]]
    const top = lerp(z) - SLAB
    const floor = lerp(groundAt)
    const foot = floor - FOOTING - WALL_SINK
    const cornerL = offset(p, left, sideAt(chain, 0, i) + 0.3, metresPerUnit)
    const cornerR = offset(p, left, -(sideAt(chain, 1, i) + 0.3), metresPerUnit)
    wall(frame, cornerL, cornerR, [top, top], [foot, foot], span, ABUTMENT.thick)
    const wing = Math.max(ABUTMENT.wingMin, Math.min(ABUTMENT.wingMax, (top - floor) * 1.5))
    for (const [corner, side] of [[cornerL, 1], [cornerR, -1]] as const) {
      const dir: Point = [back[0] * Math.cos(ABUTMENT.splay) + left[0] * side * Math.sin(ABUTMENT.splay), back[1] * Math.cos(ABUTMENT.splay) + left[1] * side * Math.sin(ABUTMENT.splay)]
      const tip = offset(corner, dir, wing, metresPerUnit)
      const tipGround = ground(tip) ?? floor
      const outward: Point = side > 0 ? [-dir[1], dir[0]] : [dir[1], -dir[0]]
      wall(frame, corner, tip, [top, Math.max(tipGround, top - wing / 1.5)], [foot, Math.min(foot, tipGround - FOOTING - WALL_SINK)], outward, ABUTMENT.wingThick)
    }
  }
}

/**
 * The raised road beyond each deck end that stands over the ground: a slab
 * as wide as the deck eased down to the ground, its top under the road laid
 * on it, with walls along its sides down into the ground. `ground` is the
 * drawn ground without the lift.
 */
export function approachMesh(approaches: Approach[], ground: (q: Point) => number | null, top: number[], wallColor: number[], frame: Frame) {
  const { origin, metresPerUnit, out } = frame
  const at = (q: Point, metres: number) => [q[0] - origin[0], q[1] - origin[1], metres / metresPerUnit]
  for (const a of approaches) {
    const w = a.half + APPROACH_WALL.beyond
    const left: Point = [-a.out[1], a.out[0]]
    const sections: Array<{ l: Point; c: Point; r: Point; zl: number; zc: number; zr: number; gl: number; gr: number }> = []
    for (let s = 0; s <= APPROACH_SLAB.length; s += APPROACH_WALL.step) {
      const c = offset(a.p, a.out, s, metresPerUnit)
      const [l, r] = [offset(c, left, w, metresPerUnit), offset(c, left, -w, metresPerUnit)]
      const [gl, gc, gr] = [ground(l), ground(c), ground(r)]
      if (gl === null || gc === null || gr === null) break
      const lift = approachLift([a], c, metresPerUnit)
      sections.push({ l, c, r, gl, gr, zl: gl + lift, zc: gc + lift, zr: gr + lift })
      if (lift < 0.02) break
    }
    for (let k = 1; k < sections.length; k++) {
      const [u, v] = [sections[k - 1], sections[k]]
      // Biased toward the eye as the road laid on it is, so it shows over the coarser drawn ground.
      facing(out, [at(u.l, u.zl), at(u.c, u.zc), at(v.c, v.zc), at(v.l, v.zl)], [0, 0, 1], top, TOUCHDOWN.bias)
      facing(out, [at(u.c, u.zc), at(u.r, u.zr), at(v.r, v.zr), at(v.c, v.zc)], [0, 0, 1], top, TOUCHDOWN.bias)
      const wf = { ...frame, color: wallColor }
      wall(wf, u.l, v.l, [u.zl, v.zl], [u.gl - WALL_SINK, v.gl - WALL_SINK], left, APPROACH_WALL.thick)
      wall(wf, u.r, v.r, [u.zr, v.zr], [u.gr - WALL_SINK, v.gr - WALL_SINK], [-left[0], -left[1]], APPROACH_WALL.thick)
    }
  }
}
