/**
 * Lane paint laid onto solved road surfaces — a bridge deck, or the floor of a
 * tunnel's cut — as flat quads a few centimetres over the asphalt. So are the
 * sidewalks, cycle tracks and rails a bridge carries, which the flat map draws
 * as lines.
 */
import earcut from 'earcut'
import { atHit, boundsOf, clip, convexClip, holds, planeOf, meets, TOUCHDOWN, type Bounds, densify, linesOf, mercator, metresPerUnit, onDeck, onOwnDeck, subtractConvex, topZ, polygonsOf, tileBounds, vertex, type DeckSurface, type Hit, type Mesh, type Point } from './decks'

export type Paint = { props: Record<string, any>; runs: Point[][]; areas: Point[][][] }

export type PaintColors = { white: number[]; yellow: number[]; green: number[]; red: number[]; asphalt?: number[] }

/** Paint widths in metres, and the dash for a dashed line. */
const PAINT_WIDTH: Record<string, number> = { centre: 0.12, lane: 0.12, edge: 0.15, bike: 0.15, stop: 0.45, hatch: 0.2 }
const DASH = { on: 3, off: 9 }
/** Marks painted across their road rather than along it. */
const ACROSS = new Set(['stop', 'yield'])
/** Metres between height samples along paint. */
const PAINT_SAMPLE = 3
/** A walkway's width where the map gives none, a rail's, and the track gauge, in metres. */
const WALKWAY = 2.5
const RAIL = 0.12
const GAUGE = 1.435
/**
 * Where the road beyond a deck is laid on it: within AT_GRADE.reach metres of
 * one of its ends, and no more than AT_GRADE.over over the ground, so a road
 * passing under it is never lifted onto it.
 */
export const AT_GRADE = { reach: 15, over: 6 }

/** Whether a deck, `t` of the way along its segment ending at `i`, is near enough its end and low enough to carry the road beyond it. */
function atGradeAt(deck: DeckSurface, i: number, t: number): boolean {
  const at = (v: number[]) => v[i - 1] + (v[i] - v[i - 1]) * t
  const d = at(deck.d)
  return Math.min(d, deck.d[deck.d.length - 1] - d) <= AT_GRADE.reach && at(deck.z) - (deck.ground ? at(deck.ground) : -Infinity) < AT_GRADE.over
}

/** A deck segment's drawn top, as `deckMesh` laid it, its corners at the deck's very ends run on a little past them. */
function drawnQuad(deck: DeckSurface, i: number): Point[] | null {
  const tops = deck.tops
  const q = tops?.[i - 1]
  if (!tops || !q) return null
  const pts = deck.points
  const n = pts.length
  const scale = END_OVERLAP / metresPerUnit(pts[0][1])
  const away = (a: Point, b: Point): Point => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return [((b[0] - a[0]) / len) * scale, ((b[1] - a[1]) / len) * scale]
  }
  // A skewed end's corners can collapse onto one another along the last segments, so corners are matched by place.
  const ends: Array<[number[], Point]> = [
    [tops[0][0], away(pts[1], pts[0])], [tops[0][1], away(pts[1], pts[0])],
    [tops[tops.length - 1][3], away(pts[n - 2], pts[n - 1])], [tops[tops.length - 1][2], away(pts[n - 2], pts[n - 1])],
  ]
  return q.map(c => {
    const end = ends.find(([e]) => e[0] === c[0] && e[1] === c[1])
    return (end ? [c[0] + end[1][0], c[1] + end[1][1]] : [c[0], c[1]]) as Point
  })
}

/** Metres what is laid on a deck runs on past its drawn end. */
const END_OVERLAP = 0.25

const centroidOf = (p: Point[]): Point => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length]

/** How far below its lift on a deck paint on the ground beside one is laid, so the deck's own wins where both are. */
const GROUND_UNDER = 0.05
/** Metres apart in height two decks under one painted triangle may be and still both carry it. */
const LEVEL = 1

/** A served road marking as runs and areas, clipped to its tile. */
export function paintOf(feature: any): Paint {
  const props = feature.properties ?? {}
  const tile = tileBounds(feature)
  // A crosswalk line is dashed into bars by the style; only its filled form draws here.
  const runs = props.kind === 'crosswalk' ? [] : linesOf(feature.geometry).flatMap(line => (tile ? clip(line.map(mercator), tile) : [line.map(mercator)]))
  const areas = polygonsOf(feature.geometry).map(rings => rings.map(ring => densify(ring.map(mercator), PAINT_SAMPLE)))
  return { props, runs, areas }
}

/** What a mark is laid on: the deck under each point, and whether it keeps its colour below street zoom. */
type Laid = { under: Array<Hit | null>; surfaces: DeckSurface[]; keep?: boolean; grounded?: boolean; ground?: Ground }

/**
 * The ground beside a deck's ends, where a bridge's own road and paint carry on
 * past the deck's skewed edge: heights in the terrain's metres, where it may be
 * laid, and its colour below street zoom.
 */
export type Ground = { at: (p: Point) => number | null; near: Bounds[]; low: number[] }

/** A point on the ground as a hit on no deck: null where the ground is not known, or, `nearEnd`, away from every deck's end. */
function onGround(laid: Laid, p: Point, nearEnd = true): Hit | null {
  const g = laid.ground
  if (!g || (nearEnd && !g.near.some(b => holds(b, p)))) return null
  const z = g.at(p)
  return z === null || Number.isNaN(z) ? null : { deck: -1, distance: 0, z, segment: 1, t: 0 }
}

/**
 * Every marking laid on the surfaces beneath it; what lies on none is left
 * out. Paint `atGrade` is the road's beyond a bridge, laid only where a deck
 * lies on the ground and so would hide it.
 */
export function layPaint(mesh: Mesh, paint: Paint[], surfaces: DeckSurface[], colors: PaintColors, origin: Point, { atGrade = false, ground }: { atGrade?: boolean; ground?: Ground } = {}) {
  const grounded = (hit: Hit | null) => (hit && atGradeAt(surfaces[hit.deck], hit.segment, hit.t) ? hit : null)
  for (const { props, runs, areas } of paint) {
    // Kept only so replication can find it; no layer draws it.
    if (props.pattern === 'none') continue
    const color = props.color === 'yellow' ? colors.yellow : props.color === 'red' ? colors.red : props.color === 'green' ? colors.green
      : props.color === 'asphalt' ? (colors.asphalt ?? colors.white) : colors.white
    const lines = runs.map(run => densify(run, PAINT_SAMPLE))
    const laid = onOwnDeck(lines, areas.flat(), surfaces, { across: ACROSS.has(props.kind) }).under
    const under = atGrade ? { lines: laid.lines.map(l => l.map(grounded)), rings: laid.rings.map(r => r.map(grounded)) } : laid
    let next = 0
    // Coloured lanes lie under the lines; white bars over them.
    const lift = props.color === 'white' ? 0.03 : props.color === 'asphalt' ? 0.01 : 0.02
    for (const rings of areas) fill(mesh, rings, { under: under.rings.slice(next, (next += rings.length)).flat(), surfaces, grounded: atGrade, ground }, color, lift, origin)
    const width = PAINT_WIDTH[props.kind] ?? 0.12
    for (const [k, line] of lines.entries())
      for (const offset of props.pattern === 'double' ? [-0.15, 0.15] : [0])
        strip(mesh, line, { under: under.lines[k], surfaces, ground }, width, color, 0.04, offset, String(props.pattern).startsWith('dashed') ? DASH : null, origin)
  }
}

/** A route laid over the surfaces beneath it, on a darker casing. */
export function layRoute(mesh: Mesh, lines: Point[][], surfaces: DeckSurface[], colors: { route: number[]; routeCasing: number[] }, origin: Point) {
  const dense = lines.map(line => densify(line, PAINT_SAMPLE))
  const { under } = onOwnDeck(dense, [], surfaces, { centred: true })
  for (const [k, line] of dense.entries()) {
    strip(mesh, line, { under: under.lines[k], surfaces, keep: true }, 4.4, colors.routeCasing, 0.06, 0, null, origin)
    strip(mesh, line, { under: under.lines[k], surfaces, keep: true }, 3, colors.route, 0.08, 0, null, origin)
  }
}

export type WayColors = { walkway: number[]; rail: number[] }

/**
 * A bridge's own sidewalks, footpaths and cycle tracks, and its rails, laid on
 * the deck that carries them, so they run on from the ground across it.
 */
export function layWays(mesh: Mesh, ways: Array<{ kind: 'path' | 'rail'; points: Point[] }>, surfaces: DeckSurface[], colors: WayColors, origin: Point) {
  for (const { kind, points } of ways) {
    const line = densify(points, PAINT_SAMPLE)
    const under = onOwnDeck([line], [], surfaces).under.lines[0]
    // A footbridge is walkway already.
    const laid = { under: kind === 'path' ? under.map(h => (h && surfaces[h.deck].kind === 'path' ? null : h)) : under, surfaces }
    if (kind === 'path') strip(mesh, line, laid, WALKWAY, colors.walkway, 0.005, 0, null, origin)
    else for (const side of [-1, 1]) strip(mesh, line, laid, RAIL, colors.rail, 0.03, (side * GAUGE) / 2, null, origin)
  }
}

/** A vertex laid on the deck under it, at its colour there below street zoom and its bias. */
function laidVertex(mesh: Mesh, p: number[], hit: Hit, { surfaces, keep, ground }: Laid, color: number[]) {
  if (hit.deck < 0) return vertex(mesh, p, [0, 0, 1], color, keep ? color : (ground?.low ?? color), TOUCHDOWN.bias)
  const deck = surfaces[hit.deck]
  vertex(mesh, p, [0, 0, 1], color, keep ? color : (deck.low ?? color), atHit(deck.bias, hit))
}

/** A painted area on the decks under its corners, where every corner of a triangle has one. */
function fill(mesh: Mesh, rings: Point[][], laid: Laid, color: number[], lift: number, origin: Point) {
  const flat = rings.flat()
  const index = earcut(flat.flat(), rings.slice(0, -1).reduce<number[]>((holes, ring) => [...holes, (holes.at(-1) ?? 0) + ring.length], []))
  const scale = 1 / metresPerUnit(flat[0]?.[1] ?? 0.5)
  // The level of the mark about a point: the deck under its nearest corner on one; with none, it is cut to no deck.
  const onAny = flat.flatMap((p, k) => (laid.under[k] ? [{ p, z: laid.under[k]!.z }] : []))
  const levelNear = (q: Point) => onAny.length
    ? onAny.reduce((a, b) => (Math.hypot(b.p[0] - q[0], b.p[1] - q[1]) < Math.hypot(a.p[0] - q[0], a.p[1] - q[1]) ? b : a)).z
    : null
  for (let t = 0; t < index.length; t += 3) {
    const corners = [index[t], index[t + 1], index[t + 2]]
    const tri = corners.map(k => flat[k])
    const box = boundsOf(tri)
    const centre = centroidOf(tri)
    // Cut to each deck at the mark's level, top triangle by top triangle and never subdivided, so neighbouring pieces meet exactly.
    const level = levelNear(centre)
    if (level !== null)
      for (const [k, d] of laid.surfaces.entries())
        if (d.tops && d.bounds && meets(d.bounds, box) && Math.abs(hitOn(laid, k, centre)!.z - level) <= LEVEL) onTops(mesh, tri, k, laid, color, lift, origin)
    // Beside a deck's end the rest lies on the ground: the triangle less every deck lying low here.
    const ground = laid.ground ? onGround(laid, centre, false) : null
    if (ground) {
      let rest = [tri]
      for (const [k, d] of laid.surfaces.entries()) {
        if (!d.tops || !d.bounds || !meets(d.bounds, box) || hitOn(laid, k, centre)!.z - ground.z >= AT_GRADE.over) continue
        for (let i = 1; i < d.points.length && rest.length; i++) {
          const quad = drawnQuad(d, i)!
          if (meets(boundsOf(quad), box)) rest = rest.flatMap(piece => subtractConvex(piece, quad))
        }
      }
      for (const piece of rest) {
        const hits = piece.map(p => onGround(laid, p, false))
        if (!hits.every(Boolean) || !onGround(laid, centroidOf(piece))) continue
        for (let v = 1; v < piece.length - 1; v++)
          split(mesh, [0, v, v + 1].map(j => ({ p: piece[j], hit: hits[j]! })), laid, color, lift - GROUND_UNDER, origin, scale)
      }
    }
  }
}

/** A triangle laid on a deck's drawn top: cut to each of its top triangles, each piece at that triangle's plane. */
function onTops(mesh: Mesh, triangle: Point[], k: number, laid: Laid, color: number[], lift: number, origin: Point) {
  const deck = laid.surfaces[k]
  const scale = 1 / metresPerUnit(triangle[0][1])
  const box = boundsOf(triangle)
  for (let i = 1; i < deck.points.length; i++) {
    if (laid.grounded && !atGradeAt(deck, i, 0) && !atGradeAt(deck, i, 1)) continue
    const top = deck.tops![i - 1]
    const outline = drawnQuad(deck, i)!
    if (!meets(boundsOf(outline), box)) continue
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
      const piece = convexClip(triangle, [outline[a], outline[b], outline[c]])
      if (piece.length < 3) continue
      const plane = planeOf(top[a], top[b], top[c])
      const hits = piece.map(p => ({ deck: k, distance: 0, z: plane(p), segment: i, t: 0 }))
      for (let v = 1; v < piece.length - 1; v++)
        for (const j of [0, v, v + 1]) laidVertex(mesh, [piece[j][0] - origin[0], piece[j][1] - origin[1], (hits[j].z + lift) * scale], hits[j], laid, color)
    }
  }
}


/** A deck's height under a point, from its nearest segment. */
function hitOn(laid: Laid, k: number, p: Point): Hit | null {
  if (k < 0) return onGround(laid, p, false)
  const deck = laid.surfaces[k]
  let best: Hit = { deck: k, distance: Infinity, z: deck.z[0], segment: 1, t: 0 }
  for (let i = 1; i < deck.points.length; i++) {
    const [a, b] = [deck.points[i - 1], deck.points[i]]
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
    const distance = Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1])
    if (distance < best.distance) best = { deck: k, distance, z: topZ(deck, i, p) ?? deck.z[i - 1] + (deck.z[i] - deck.z[i - 1]) * t, segment: i, t }
  }
  return best
}

/**
 * A painted triangle laid in pieces no longer a side than PAINT_SAMPLE: a deck
 * arches, and a long triangle drawn straight between its corners would dip
 * under the surface between them.
 */
function split(mesh: Mesh, corners: Array<{ p: Point; hit: Hit }>, laid: Laid, color: number[], lift: number, origin: Point, scale: number, depth = 0) {
  // Ground is kept only beside a deck's end, so a piece of it away from every end is not split further.
  const near = laid.ground?.near
  if (corners[0].hit.deck < 0 && near && !near.some(b => meets(b, boundsOf(corners.map(c => c.p))))) return
  const length = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]) / scale
  const sides = [0, 1, 2].map(e => length(corners[e].p, corners[(e + 1) % 3].p))
  const e = sides.indexOf(Math.max(...sides))
  if (sides[e] <= PAINT_SAMPLE || depth > 12) {

    for (const { p, hit } of corners) laidVertex(mesh, [p[0] - origin[0], p[1] - origin[1], (hit.z + lift) * scale], hit, laid, color)
    return
  }
  const [a, b, c] = [corners[e], corners[(e + 1) % 3], corners[(e + 2) % 3]]
  const mid: Point = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2]
  const hit = hitOn(laid, a.hit.deck, mid)
  if (!hit) return
  const m = { p: mid, hit }
  split(mesh, [a, m, c], laid, color, lift, origin, scale, depth + 1)
  split(mesh, [m, b, c], laid, color, lift, origin, scale, depth + 1)
}


/** Paint along a line on the decks under its points, as flat quads, dashed when given a dash. */
function strip(mesh: Mesh, points: Point[], laid: Laid, width: number, color: number[], lift: number, offset: number, dash: { on: number; off: number } | null, origin: Point) {
  let travelled = 0
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const scale = 1 / metresPerUnit(a[1])
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    const metres = seg / scale
    const off = !laid.under[i - 1] || !laid.under[i]
    const beside = off && onDeck([[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]], laid.surfaces, 0)[0] === null
    const [ha, hb] = !off ? [laid.under[i - 1], laid.under[i]] : beside ? [onGround(laid, a), onGround(laid, b)] : [null, null]
    if (!ha || !hb || seg === 0) {
      travelled += metres
      continue
    }
    const [za, zb] = [ha.z + lift, hb.z + lift]
    const ux = (b[0] - a[0]) / seg
    const uy = (b[1] - a[1]) / seg
    const nx = -uy * scale
    const ny = ux * scale
    const pieces: Array<[number, number]> = []
    if (dash) {
      const period = dash.on + dash.off
      for (let s = -(travelled % period); s < metres; s += period) pieces.push([Math.max(0, s), Math.min(metres, s + dash.on)])
    } else pieces.push([0, metres])
    for (const [s0, s1] of pieces) {
      if (s1 <= s0) continue
      const at = (s: number, side: number) => {
        const t = s / metres
        return [
          a[0] + (b[0] - a[0]) * t + nx * (offset + side * width / 2) - origin[0],
          a[1] + (b[1] - a[1]) * t + ny * (offset + side * width / 2) - origin[1],
          (za + (zb - za) * t) * scale,
        ]
      }
      const corners = [at(s0, 1), at(s0, -1), at(s1, -1), at(s1, 1)]
      const hits = [ha, ha, hb, hb]
      for (const tri of [[0, 1, 2], [0, 2, 3]]) for (const k of tri) laidVertex(mesh, corners[k], hits[k], laid, color)
    }
    travelled += metres
  }
}
