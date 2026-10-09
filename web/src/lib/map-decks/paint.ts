/**
 * Lane paint laid onto solved road surfaces — a bridge deck, or the floor of a
 * tunnel's cut — as flat quads a few centimetres over the asphalt.
 */
import earcut from 'earcut'
import { clip, densify, linesOf, mercator, metresPerUnit, onDeck, polygonsOf, tileBounds, type Mesh, type Point } from './decks'

/** A surface paint can lie on: a centreline, its heights, distances along it, and its width in metres. */
export type Surface = Parameters<typeof onDeck>[1][number]

export type Paint = { props: Record<string, any>; runs: Point[][]; areas: Point[][][] }

export type PaintColors = { white: number[]; yellow: number[]; green: number[]; red: number[] }

/** Paint widths in metres, and the dash for a dashed line. */
const PAINT_WIDTH: Record<string, number> = { centre: 0.12, lane: 0.12, edge: 0.15, bike: 0.15, stop: 0.45 }
const DASH = { on: 3, off: 9 }
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
export function layPaint(mesh: Mesh, paint: Paint[], surfaces: Surface[], colors: PaintColors, origin: Point) {
  for (const { props, runs, areas } of paint) {
    const color = props.color === 'yellow' ? colors.yellow : props.color === 'red' ? colors.red : props.color === 'green' ? colors.green : colors.white
    // Coloured lanes lie under the lines; white bars over them.
    for (const rings of areas) fill(mesh, rings, surfaces, color, props.color === 'white' ? 0.03 : 0.02, origin)
    const width = PAINT_WIDTH[props.kind] ?? 0.12
    for (const run of runs)
      for (const offset of props.pattern === 'double' ? [-0.15, 0.15] : [0])
        strip(mesh, run, surfaces, width, color, 0.04, offset, String(props.pattern).startsWith('dashed'), origin)
  }
}

/** A painted area laid on the surfaces, where every corner of a triangle is on one. */
export function fill(mesh: Mesh, rings: Point[][], surfaces: Surface[], color: number[], lift: number, origin: Point) {
  const flat = rings.flat()
  const z = onDeck(flat, surfaces, lift)
  const index = earcut(flat.flat(), rings.slice(0, -1).reduce<number[]>((holes, ring) => [...holes, (holes.at(-1) ?? 0) + ring.length], []))
  const scale = 1 / metresPerUnit(flat[0]?.[1] ?? 0.5)
  for (let t = 0; t < index.length; t += 3) {
    const corners = [index[t], index[t + 1], index[t + 2]]
    if (corners.some(k => z[k] === null)) continue
    for (const k of corners) {
      mesh.position.push(flat[k][0] - origin[0], flat[k][1] - origin[1], z[k]! * scale)
      mesh.normal.push(0, 0, 1)
      mesh.color.push(color[0], color[1], color[2])
    }
  }
}

/** Paint along a line, lifted onto the surfaces under it, as flat quads. */
export function strip(mesh: Mesh, line: Point[], surfaces: Surface[], width: number, color: number[], lift: number, offset: number, dashed: boolean, origin: Point) {
  const points = densify(line, PAINT_SAMPLE)
  const z = onDeck(points, surfaces, lift)
  let travelled = 0
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const scale = 1 / metresPerUnit(a[1])
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    const metres = seg / scale
    const za = z[i - 1]
    const zb = z[i]
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
