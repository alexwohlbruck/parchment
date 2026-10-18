/**
 * Lane paint laid onto solved road surfaces — a bridge deck, or the floor of a
 * tunnel's cut — as flat quads a few centimetres over the asphalt. So are the
 * sidewalks, cycle tracks and rails a bridge carries, which the flat map draws
 * as lines.
 */
import earcut from 'earcut'
import { atHit, beside, boundsOf, smoothstep, clip, convexClip, holds, planeOf, meets, TOUCHDOWN, type Bounds, densify, linesOf, mercator, metresPerUnit, onDeck, onOwnDeck, subtractConvex, topZ, polygonsOf, tileBounds, vertex, type DeckSurface, type Hit, type Mesh, type Point } from './decks'

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

const quads = new WeakMap<DeckSurface, Array<{ quad: Point[] | null; bounds: Bounds | null }>>()

/** `drawnQuad` and its bounds, worked out once per deck segment: paint asks for them per triangle. */
function quadOf(deck: DeckSurface, i: number): { quad: Point[] | null; bounds: Bounds | null } {
  let list = quads.get(deck)
  if (!list) quads.set(deck, (list = []))
  let q = list[i]
  if (!q) {
    const quad = drawnQuad(deck, i)
    q = list[i] = { quad, bounds: quad ? boundsOf(quad) : null }
  }
  return q
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
type Laid = { under: Array<Hit | null>; surfaces: DeckSurface[]; keep?: boolean; grounded?: boolean; ground?: Ground; on?: (deck: DeckSurface) => boolean }

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

/** Least cosine between a line and the deck under it for the line to be laid on the deck's end. */
const ALONG_COS = Math.cos(Math.PI / 6)

/** A mark's height on a deck's at-grade end: the deck's, or the drawn ground's where that stands higher and would hide it. */
function onTop(ground: Ground | undefined, deck: DeckSurface, i: number, t: number, p: Point, z: number): number {
  if (!ground || !atGradeAt(deck, i, t)) return z
  const g = ground.at(p)
  return g !== null && g > z ? g : z
}

/** The road beyond a bridge way's end: the end, its outward direction (unit), and how far along and across from it is past it, in metres. */
export type PastEnd = { p: Point; out: Point; reach: number; half: number }

/** Whether a point lies on the road beyond a bridge way's end. */
function isPast({ p, out, reach, half }: PastEnd, q: Point): boolean {
  const scale = metresPerUnit(p[1])
  const [dx, dy] = [(q[0] - p[0]) * scale, (q[1] - p[1]) * scale]
  const along = dx * out[0] + dy * out[1]
  return along >= -1 && along <= reach && Math.abs(dy * out[0] - dx * out[1]) <= half
}

/** Whether a line at its `i`th point runs with the deck segment under it. */
function runsAlong(surfaces: DeckSurface[], hit: Hit | null, line: Point[], i: number): boolean {
  if (!hit || line.length < 2) return false
  const pts = surfaces[hit.deck].points
  const [a, b] = [pts[hit.segment - 1], pts[hit.segment]]
  const [p, q] = [line[Math.max(0, i - 1)], line[Math.min(line.length - 1, i + 1)]]
  const [dx, dy, lx, ly] = [b[0] - a[0], b[1] - a[1], q[0] - p[0], q[1] - p[1]]
  const norm = Math.hypot(dx, dy) * Math.hypot(lx, ly)
  return norm > 0 && Math.abs(dx * lx + dy * ly) / norm >= ALONG_COS
}

/**
 * Every marking laid on the surfaces beneath it; what lies on none is left
 * out. Paint `atGrade` is the road's beyond a bridge, laid only where a deck
 * lies on the ground and so would hide it. Areas go only on the decks `on` accepts.
 */
export function layPaint(mesh: Mesh, paint: Paint[], surfaces: DeckSurface[], colors: PaintColors, origin: Point, { atGrade = false, ground, past, parts = 'both', on }: { atGrade?: boolean; ground?: Ground; past?: PastEnd[]; parts?: 'areas' | 'lines' | 'both'; on?: (deck: DeckSurface) => boolean } = {}) {
  const grounded = (hit: Hit | null) => (hit && atGradeAt(surfaces[hit.deck], hit.segment, hit.t) ? hit : null)
  for (const { props, runs, areas } of paint) {
    // Kept only so replication can find it; no layer draws it.
    if (props.pattern === 'none') continue
    const color = props.color === 'yellow' ? colors.yellow : props.color === 'red' ? colors.red : props.color === 'green' ? colors.green
      : props.color === 'asphalt' ? (colors.asphalt ?? colors.white) : colors.white
    const lines = runs.map(run => densify(run, PAINT_SAMPLE))
    const flat = areas.flat()
    const laid = onOwnDeck(lines, flat, surfaces, { across: ACROSS.has(props.kind) }).under
    // A road's lines are laid on a deck's end only where they run with it: a road crossing at the end is the deck's to cover.
    // A bridge's line or ring lying wholly past its end is at grade: a deck high overhead there is another road's.
    const beyond = (points: Point[]) => !!past?.length && points.every(q => past.some(e => isPast(e, q)))
    const own = (hits: Array<Hit | null>, points: Point[]) => (beyond(points) ? hits.map(h => (h && !atGradeAt(surfaces[h.deck], h.segment, h.t) ? null : h)) : hits)
    const under = atGrade
      ? { lines: laid.lines.map((l, k) => l.map((h, i) => (runsAlong(surfaces, h, lines[k], i) ? grounded(h) : null))), rings: laid.rings.map(r => r.map(grounded)) }
      : past?.length ? { lines: laid.lines.map((l, k) => own(l, lines[k])), rings: laid.rings.map((r, k) => own(r, flat[k])) }
      : laid
    let next = 0
    const lift = props.color === 'white' ? 0.03 : props.color === 'asphalt' ? 0.01 : 0.02
    if (parts !== 'lines') for (const rings of areas) fill(mesh, rings, { under: under.rings.slice(next, (next += rings.length)).flat(), surfaces, grounded: atGrade, ground, on }, color, lift, origin)
    const width = PAINT_WIDTH[props.kind] ?? 0.12
    if (parts !== 'areas') for (const [k, line] of lines.entries())
      for (const offset of props.pattern === 'double' ? [-0.15, 0.15] : [0])
        strip(mesh, line, { under: under.lines[k].map((h, i) => (h && h.deck >= 0 ? { ...h, z: onTop(ground, surfaces[h.deck], h.segment, h.t, line[i], h.z) } : h)), surfaces, ground }, width, color, 0.04, offset, String(props.pattern).startsWith('dashed') ? DASH : null, origin)
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
    // A footbridge, or a street deck's top beside its carriageway, is walkway already.
    // A path crossing a street deck's carriageway is laid on it still.
    const walkway = (h: Hit | null, i: number) => !!h && (surfaces[h.deck].kind === 'path' || (!!surfaces[h.deck].sidewalks && runsAlong(surfaces, h, line, i)))
    const laid = { under: kind === 'path' ? under.map((h, i) => (walkway(h, i) ? null : h)) : under, surfaces }
    if (kind === 'path') strip(mesh, line, laid, WALKWAY, colors.walkway, 0.005, 0, null, origin)
    else for (const side of [-1, 1]) strip(mesh, line, laid, RAIL, colors.rail, 0.03, (side * GAUGE) / 2, null, origin)
  }
}

/** A vertex laid on the deck under it, at its colour there below street zoom and its bias. */
function laidVertex(mesh: Mesh, p: number[], hit: Hit, { surfaces, keep, ground }: Laid, color: number[], spread?: number[]) {
  if (hit.deck < 0) return vertex(mesh, p, [0, 0, 1], color, keep ? color : (ground?.low ?? color), TOUCHDOWN.bias, spread)
  const deck = surfaces[hit.deck]
  vertex(mesh, p, [0, 0, 1], color, keep ? color : (deck.low ?? color), atHit(deck.bias, hit), spread)
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
    // Cut to each road deck at the mark's level, top triangle by top triangle and never subdivided, so neighbouring pieces meet exactly.
    const level = levelNear(centre)
    if (level !== null)
      for (const [k, d] of laid.surfaces.entries())
        if (d.kind === 'road' && d.tops && d.bounds && (!laid.on || laid.on(d)) && meets(d.bounds, box) && Math.abs(hitOn(laid, k, centre)!.z - level) <= LEVEL) onTops(mesh, tri, k, laid, color, lift, origin)
    // Beside a deck's end the rest lies on the ground: the triangle less every stretch of deck lying low.
    if (laid.ground && onGround(laid, centre, false)) {
      let rest = [tri]
      for (const d of laid.surfaces) {
        if (!d.tops || !d.bounds || !meets(d.bounds, box)) continue
        for (let i = 1; i < d.points.length && rest.length; i++) {
          if (d.ground && Math.min(d.z[i - 1] - d.ground[i - 1], d.z[i] - d.ground[i]) >= AT_GRADE.over) continue
          const { quad, bounds } = quadOf(d, i)
          if (meets(bounds!, box)) rest = rest.flatMap(piece => subtractConvex(piece, quad!))
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
    const { quad, bounds } = quadOf(deck, i)
    if (!meets(bounds!, box)) continue
    const outline = quad!
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
      const piece = convexClip(triangle, [outline[a], outline[b], outline[c]])
      if (piece.length < 3) continue
      const plane = planeOf(top[a], top[b], top[c])
      // The deck's top is drawn toward the eye by its corners' bias; what lies on it must be too, or terrain shows through at its ends.
      const bias = deck.bias ? [deck.bias[i - 1], deck.bias[i - 1], deck.bias[i], deck.bias[i]] : [0, 0, 0, 0]
      const biasAt = planeOf([...top[a].slice(0, 2), bias[a]], [...top[b].slice(0, 2), bias[b]], [...top[c].slice(0, 2), bias[c]])
      const hits = piece.map(p => ({ deck: k, distance: 0, z: onTop(laid.ground, deck, i, 0.5, p, plane(p)), segment: i, t: biasT(deck, i, biasAt(p)) }))
      for (let v = 1; v < piece.length - 1; v++)
        for (const j of [0, v, v + 1]) laidVertex(mesh, [piece[j][0] - origin[0], piece[j][1] - origin[1], (hits[j].z + lift) * scale], hits[j], laid, color)
    }
  }
}


/** The `t` along segment `i` at which the deck's bias is `bias`, so `atHit` gives it back. */
function biasT(deck: DeckSurface, i: number, bias: number): number {
  const [b0, b1] = [deck.bias?.[i - 1] ?? 0, deck.bias?.[i] ?? 0]
  return b1 === b0 ? 0 : Math.max(0, Math.min(1, (bias - b0) / (b1 - b0)))
}

/** A deck's height under a point, from its nearest segment. */
function hitOn(laid: Laid, k: number, p: Point): Hit | null {
  if (k < 0) return onGround(laid, p, false)
  const deck = laid.surfaces[k]
  let [distance, segment, t] = [Infinity, 1, 0]
  for (let i = 1; i < deck.points.length; i++) {
    const [a, b] = [deck.points[i - 1], deck.points[i]]
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
    const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
    const d = Math.hypot(a[0] + dx * u - p[0], a[1] + dy * u - p[1])
    if (d < distance) [distance, segment, t] = [d, i, u]
  }
  if (distance === Infinity) return { deck: k, distance, z: deck.z[0], segment: 1, t: 0 }
  return { deck: k, distance, z: topZ(deck, segment, p) ?? deck.z[segment - 1] + (deck.z[segment] - deck.z[segment - 1]) * t, segment, t }
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
    // Where a line leaves a deck's end for the ground, the step between them is laid from the one to the other.
    const onEnd = (h: Hit | null) => !!h && h.deck >= 0 && atGradeAt(laid.surfaces[h.deck], h.segment, h.t)
    const leaving = off && !beside && !!laid.ground && (onEnd(laid.under[i - 1]) || onEnd(laid.under[i]))
    const [ha, hb] = !off ? [laid.under[i - 1], laid.under[i]]
      : beside ? [onGround(laid, a), onGround(laid, b)]
      : leaving ? [laid.under[i - 1] ?? onGround(laid, a), laid.under[i] ?? onGround(laid, b)]
      : [null, null]
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
      const out = [[nx, ny, width / 2], [-nx, -ny, width / 2]]
      const spreads = [out[0], out[1], out[1], out[0]]
      for (const tri of [[0, 1, 2], [0, 2, 3]]) for (const k of tri) laidVertex(mesh, corners[k], hits[k], laid, color, spreads[k])
    }
    travelled += metres
  }
}

/** How far beside a bridge line's end a ground line may run, and how near its own end, to carry it on; and how far the bridge's eases onto it, in metres. */
const LINE_JOIN = { reach: 1.5, end: 6, ease: 8 }

/** Bridge lines eased onto the same lines on the ground they run on into, those cut where the bridge's end, so neither steps nor doubles. */
export function joinedLines(bridge: Paint[], ground: Paint[]): { bridge: Paint[]; ground: Paint[] } {
  const same = (a: Paint, b: Paint) => a.props.kind === b.props.kind && a.props.color === b.props.color && a.props.pattern === b.props.pattern
  const groundRuns = ground.map(g => g.runs.map(run => [...run]))
  const bridgeOut = bridge.map(paint => {
    if (!paint.runs.length) return paint
    const runs = paint.runs.map(raw => {
      if (raw.length < 2) return raw
      let out = densify(raw, PAINT_SAMPLE)
      for (const end of [0, 1] as const) {
        const [tip, inner] = end ? [out[out.length - 1], out[out.length - 2]] : [out[0], out[1]]
        const other = out[end ? 0 : out.length - 1]
        let best: { g: number; r: number; p: Point; segment: number; distance: number } | null = null
        for (const [g, paintG] of ground.entries()) {
          if (!same(paintG, paint)) continue
          for (const [r, line] of groundRuns[g].entries()) {
            if (line.length < 2 || !holds(boundsOf(line, LINE_JOIN.reach), tip)) continue
            const near = beside(line, tip)
            if (near.distance > LINE_JOIN.reach || (best && near.distance >= best.distance)) continue
            const [a, b] = [line[near.segment - 1], line[near.segment]]
            const p: Point = [a[0] + (b[0] - a[0]) * near.t, a[1] + (b[1] - a[1]) * near.t]
            const fromEnd = Math.min(...[line[0], line[line.length - 1]].map(q => Math.hypot(q[0] - p[0], q[1] - p[1]) * metresPerUnit(p[1])))
            const along = Math.abs((b[0] - a[0]) * (tip[0] - inner[0]) + (b[1] - a[1]) * (tip[1] - inner[1])) / (Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(tip[0] - inner[0], tip[1] - inner[1]) || 1)
            if (fromEnd <= LINE_JOIN.end && along >= ALONG_COS) best = { g, r, p, segment: near.segment, distance: near.distance }
          }
        }
        if (!best) continue
        out = eased(out, end, best.p)
        const line = groundRuns[best.g][best.r]
        const [head, tail] = [[...line.slice(0, best.segment), best.p], [best.p, ...line.slice(best.segment)]]
        const far = (part: Point[]) => Math.max(...part.map(q => Math.hypot(q[0] - other[0], q[1] - other[1])))
        groundRuns[best.g][best.r] = far(tail) >= far(head) ? tail : head
      }
      return out
    })
    return { ...paint, runs }
  })
  return { bridge: bridgeOut, ground: ground.map((g, k) => (g.runs.length ? { ...g, runs: groundRuns[k] } : g)) }
}

/** A line with one end moved to `to`, the move fading out over LINE_JOIN.ease metres along it. */
function eased(line: Point[], end: 0 | 1, to: Point): Point[] {
  const pts = end ? [...line].reverse() : [...line]
  const scale = metresPerUnit(pts[0][1])
  const [dx, dy] = [to[0] - pts[0][0], to[1] - pts[0][1]]
  let along = 0
  const out = pts.map((p, i) => {
    if (i) along += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) * scale
    const w = smoothstep(Math.max(0, 1 - along / LINE_JOIN.ease))
    return [p[0] + dx * w, p[1] + dy * w] as Point
  })
  return end ? out.reverse() : out
}
