import { describe, expect, test } from 'vitest'
import type { Point } from '@/lib/map-decks/decks'
import { planCoverage } from '@/lib/map-objects/landmark-coverage'
import type { Elevation } from './carve'
import { fillAt, fillTile, groundFill } from './fill'

// About a metre in mercator units at New York's latitude, from the middle of a z17 tile.
const M = 1 / 30400000
const z = 17
const [tx, ty] = [38590, 49300]
const [x0, y0] = [(tx + 0.5) / 2 ** z, (ty + 0.5) / 2 ** z]
const at = (east: number, south: number): Point => [x0 + east * M, y0 + south * M]
const metresOf = ([x, y]: Point) => [(x - x0) / M, (y - y0) / M]

/** A model covering 20 m square round its origin: a slab, as a podium would be. */
const coverage = planCoverage({
  min: [-10, 0, -10], max: [10, 1, 10],
  primitives: [{ position: new Float32Array([-10, 1, -10, 10, 1, -10, 10, 1, 10, -10, 1, 10]), index: new Uint16Array([0, 1, 2, 0, 2, 3]), node: -1 }],
})

/** A site falling 0.1 m a metre east and 0.05 a metre south. */
const slope = (p: Point) => {
  const [e, s] = metresOf(p)
  return 100 - 0.1 * e - 0.05 * s
}
/** The same site with a podium 4 m high on it, as lidar bare earth keeps one. */
const podium = (p: Point) => {
  const [e, s] = metresOf(p)
  return slope(p) + (Math.abs(e) < 11 && Math.abs(s) < 11 ? 4 : 0)
}

const fillOver = (bare: (p: Point) => number | null) => groundFill(coverage, (x, zz) => at(x, zz), 1, bare)

describe('groundFill', () => {
  test('keeps the slope of the site', () => {
    const fill = fillOver(slope)!
    for (const [e, s] of [[0, 0], [-8, 5], [9, -9]]) expect(fillAt(fill, at(e, s))).toBeCloseTo(slope(at(e, s)), 2)
  })

  test('takes out a bump the model stands on, spanning the ground round it', () => {
    const fill = fillOver(podium)!
    for (const [e, s] of [[0, 0], [-8, 5], [9, -9]]) expect(fillAt(fill, at(e, s))).toBeCloseTo(slope(at(e, s)), 1)
  })

  test('reaches just past what the model covers, and no further', () => {
    const fill = fillOver(slope)!
    expect(fillAt(fill, at(11, 0))).not.toBeNull()
    expect(fillAt(fill, at(20, 0))).toBeNull()
    expect(fillAt(fill, at(0, -20))).toBeNull()
  })

  test('waits for the ground round it to load', () => {
    expect(fillOver(p => (metresOf(p)[0] > 10 ? null : slope(p)))).toBeNull()
  })
})

describe('fillTile', () => {
  /** A 64-pixel z17 tile of a site, its pixels in a plain array. */
  const tile = (bare: (p: Point) => number): Elevation & { data: Float32Array } => {
    const [dim, border] = [64, 2]
    const stride = dim + 2 * border
    const data = new Float32Array(stride * stride)
    const index = (x: number, y: number) => (y + border) * stride + x + border
    for (let y = -border; y < dim + border; y++)
      for (let x = -border; x < dim + border; x++) data[index(x, y)] = bare([(tx + x / dim) / 2 ** z, (ty + y / dim) / 2 ** z])
    return { dim, border, data, get: (x, y) => data[index(x, y)], set: (x, y, m) => (data[index(x, y)] = m) }
  }

  test('brings the ground under the model down to the fill, and leaves the rest', () => {
    const t = tile(podium)
    const before = Float32Array.from(t.data)
    expect(fillTile(t, [z, tx, ty], fillOver(podium)!)).toBe(true)
    const centre = t.get(32, 32)
    expect(centre).toBeCloseTo(slope([(tx + 0.5) / 2 ** z, (ty + 0.5) / 2 ** z]), 0)
    const changed = t.data.filter((h, i) => h !== before[i]).length
    expect(changed).toBeGreaterThan(0)
    // About 25 m square of a 230 m tile.
    expect(changed).toBeLessThan(t.data.length / 40)
  })

  test('never raises the ground: a sunk court the terrain has right stays', () => {
    const pit = (p: Point) => podium(p) - 8
    const t = tile(pit)
    expect(fillTile(t, [z, tx, ty], fillOver(slope)!)).toBe(false)
  })

  test('leaves a tile the fill does not reach', () => {
    const t = tile(podium)
    expect(fillTile(t, [z, tx + 2, ty], fillOver(podium)!)).toBe(false)
  })
})
