/**
 * Lane paint laid onto solved road surfaces — a bridge deck, or the floor of a
 * tunnel's cut — as flat quads a few centimetres over the asphalt.
 */
import earcut from 'earcut'
import { clip, densify, linesOf, mercator, metresPerUnit, onOwnDeck, polygonsOf, tileBounds, type DeckSurface, type Mesh, type Point } from './decks'

export type Paint = { props: Record<string, any>; runs: Point[][]; areas: Point[][][] }

export type PaintColors = { white: number[]; yellow: number[]; green: number[]; red: number[] }

/** Paint widths in metres, and the dash for a dashed line. */
const PAINT_WIDTH: Record<string, number> = { centre: 0.12, lane: 0.12, edge: 0.15, bike: 0.15, stop: 0.45, hatch: 0.2 }
const DASH = { on: 3, off: 9 }
/** Marks painted across their road rather than along it. */
const ACROSS = new Set(['stop', 'yield'])
/** Metres between height samples along paint. */
const PAINT_SAMPLE = 3

/** A served road marking as runs and areas, clipped to its tile. */
export function paintOf(feature: any): Paint {
  const props = feature.properties ?? {}
  const tile = tileBounds(feature)
  // A crosswalk line is dashed into bars by the style; only its filled form draws here.
  const runs = props.kind === 'crosswalk' ? [] : linesOf(feature.geometry).flatMap(line => (tile ? clip(line.map(mercator), tile) : [line.map(mercator)]))
  const areas = polygonsOf(feature.geometry).map(rings => rings.map(ring => densify(ring.map(mercator), PAINT_SAMPLE)))
  return { props, runs, areas }
}

/** Every marking laid on the surfaces beneath it; what lies on none is left out. */
export function layPaint(mesh: Mesh, paint: Paint[], surfaces: DeckSurface[], colors: PaintColors, origin: Point) {
  for (const { props, runs, areas } of paint) {
    // Kept only so replication can find it; no layer draws it.
    if (props.pattern === 'none') continue
    const color = props.color === 'yellow' ? colors.yellow : props.color === 'red' ? colors.red : props.color === 'green' ? colors.green : colors.white
    const lines = runs.map(run => densify(run, PAINT_SAMPLE))
    const heights = onOwnDeck(lines, areas.flat(), surfaces, ACROSS.has(props.kind))
    let next = 0
    // Coloured lanes lie under the lines; white bars over them.
    for (const rings of areas) fill(mesh, rings, heights.rings.slice(next, (next += rings.length)).flat(), color, props.color === 'white' ? 0.03 : 0.02, origin)
    const width = PAINT_WIDTH[props.kind] ?? 0.12
    for (const [k, line] of lines.entries())
      for (const offset of props.pattern === 'double' ? [-0.15, 0.15] : [0])
        strip(mesh, line, heights.lines[k], width, color, 0.04, offset, String(props.pattern).startsWith('dashed'), origin)
  }
}

/** A route laid over the surfaces beneath it, on a darker casing. */
export function layRoute(mesh: Mesh, lines: Point[][], surfaces: DeckSurface[], colors: { route: number[]; routeCasing: number[] }, origin: Point) {
  const dense = lines.map(line => densify(line, PAINT_SAMPLE))
  const heights = onOwnDeck(dense, [], surfaces).lines
  for (const [k, line] of dense.entries()) {
    strip(mesh, line, heights[k], 4.4, colors.routeCasing, 0.06, 0, false, origin)
    strip(mesh, line, heights[k], 3, colors.route, 0.08, 0, false, origin)
  }
}

/** A painted area at the given corner heights, where every corner of a triangle has one. */
function fill(mesh: Mesh, rings: Point[][], heights: Array<number | null>, color: number[], lift: number, origin: Point) {
  const flat = rings.flat()
  const index = earcut(flat.flat(), rings.slice(0, -1).reduce<number[]>((holes, ring) => [...holes, (holes.at(-1) ?? 0) + ring.length], []))
  const scale = 1 / metresPerUnit(flat[0]?.[1] ?? 0.5)
  for (let t = 0; t < index.length; t += 3) {
    const corners = [index[t], index[t + 1], index[t + 2]]
    if (corners.some(k => heights[k] === null)) continue
    for (const k of corners) {
      mesh.position.push(flat[k][0] - origin[0], flat[k][1] - origin[1], (heights[k]! + lift) * scale)
      mesh.normal.push(0, 0, 1)
      mesh.color.push(color[0], color[1], color[2])
    }
  }
}

/** Paint along a line at the given heights, as flat quads. */
function strip(mesh: Mesh, points: Point[], heights: Array<number | null>, width: number, color: number[], lift: number, offset: number, dashed: boolean, origin: Point) {
  let travelled = 0
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const scale = 1 / metresPerUnit(a[1])
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    const metres = seg / scale
    const za = heights[i - 1] === null ? null : heights[i - 1]! + lift
    const zb = heights[i] === null ? null : heights[i]! + lift
    if (za === null || zb === null || seg === 0) {
      travelled += metres
      continue
    }
    const ux = (b[0] - a[0]) / seg
    const uy = (b[1] - a[1]) / seg
    const nx = -uy * scale
    const ny = ux * scale
    const pieces: Array<[number, number]> = []
    if (dashed) {
      const period = DASH.on + DASH.off
      for (let s = -(travelled % period); s < metres; s += period) pieces.push([Math.max(0, s), Math.min(metres, s + DASH.on)])
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
      for (const tri of [[0, 1, 2], [0, 2, 3]])
        for (const k of tri) {
          mesh.position.push(...corners[k])
          mesh.normal.push(0, 0, 1)
          mesh.color.push(color[0], color[1], color[2])
        }
    }
    travelled += metres
  }
}
