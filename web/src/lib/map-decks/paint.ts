/**
 * Lane paint laid onto solved road surfaces — a bridge deck, or the floor of a
 * tunnel's cut — as flat quads a few centimetres over the asphalt. So are the
 * sidewalks, cycle tracks and rails a bridge carries, which the flat map draws
 * as lines.
 */
import earcut from 'earcut'
import { atHit, BOX_MIN, clip, densify, linesOf, mercator, metresPerUnit, onOwnDeck, polygonsOf, tileBounds, vertex, type DeckSurface, type Hit, type Mesh, type Point } from './decks'

export type Paint = { props: Record<string, any>; runs: Point[][]; areas: Point[][][] }

export type PaintColors = { white: number[]; yellow: number[]; green: number[]; red: number[] }

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
type Laid = { under: Array<Hit | null>; surfaces: DeckSurface[]; keep?: boolean }

/**
 * Every marking laid on the surfaces beneath it; what lies on none is left
 * out. Paint `atGrade` is the road's beyond a bridge, laid only where a deck
 * lies on the ground and so would hide it.
 */
export function layPaint(mesh: Mesh, paint: Paint[], surfaces: DeckSurface[], colors: PaintColors, origin: Point, { atGrade = false } = {}) {
  const grounded = (hit: Hit | null) => (hit && hit.z - atHit(surfaces[hit.deck].ground, hit) < BOX_MIN ? hit : null)
  for (const { props, runs, areas } of paint) {
    // Kept only so replication can find it; no layer draws it.
    if (props.pattern === 'none') continue
    const color = props.color === 'yellow' ? colors.yellow : props.color === 'red' ? colors.red : props.color === 'green' ? colors.green : colors.white
    const lines = runs.map(run => densify(run, PAINT_SAMPLE))
    const laid = onOwnDeck(lines, areas.flat(), surfaces, { across: ACROSS.has(props.kind) }).under
    const under = atGrade ? { lines: laid.lines.map(l => l.map(grounded)), rings: laid.rings.map(r => r.map(grounded)) } : laid
    let next = 0
    // Coloured lanes lie under the lines; white bars over them.
    for (const rings of areas) fill(mesh, rings, { under: under.rings.slice(next, (next += rings.length)).flat(), surfaces }, color, props.color === 'white' ? 0.03 : 0.02, origin)
    const width = PAINT_WIDTH[props.kind] ?? 0.12
    for (const [k, line] of lines.entries())
      for (const offset of props.pattern === 'double' ? [-0.15, 0.15] : [0])
        strip(mesh, line, { under: under.lines[k], surfaces }, width, color, 0.04, offset, String(props.pattern).startsWith('dashed') ? DASH : null, origin)
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
    if (kind === 'path') strip(mesh, line, laid, WALKWAY, colors.walkway, 0.01, 0, null, origin)
    else for (const side of [-1, 1]) strip(mesh, line, laid, RAIL, colors.rail, 0.03, (side * GAUGE) / 2, null, origin)
  }
}

/** A vertex laid on the deck under it, at its colour there below street zoom and its bias. */
function laidVertex(mesh: Mesh, p: number[], hit: Hit, { surfaces, keep }: Laid, color: number[]) {
  const deck = surfaces[hit.deck]
  vertex(mesh, p, [0, 0, 1], color, keep ? color : (deck.low ?? color), atHit(deck.bias, hit))
}

/** A painted area on the decks under its corners, where every corner of a triangle has one. */
function fill(mesh: Mesh, rings: Point[][], laid: Laid, color: number[], lift: number, origin: Point) {
  const flat = rings.flat()
  const index = earcut(flat.flat(), rings.slice(0, -1).reduce<number[]>((holes, ring) => [...holes, (holes.at(-1) ?? 0) + ring.length], []))
  const scale = 1 / metresPerUnit(flat[0]?.[1] ?? 0.5)
  for (let t = 0; t < index.length; t += 3) {
    const corners = [index[t], index[t + 1], index[t + 2]]
    if (corners.some(k => !laid.under[k])) continue
    for (const k of corners) {
      const hit = laid.under[k]!
      laidVertex(mesh, [flat[k][0] - origin[0], flat[k][1] - origin[1], (hit.z + lift) * scale], hit, laid, color)
    }
  }
}

/** Paint along a line on the decks under its points, as flat quads, dashed when given a dash. */
function strip(mesh: Mesh, points: Point[], laid: Laid, width: number, color: number[], lift: number, offset: number, dash: { on: number; off: number } | null, origin: Point) {
  let travelled = 0
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const scale = 1 / metresPerUnit(a[1])
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    const metres = seg / scale
    const [ha, hb] = [laid.under[i - 1], laid.under[i]]
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
