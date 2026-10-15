import { describe, test, expect } from 'vitest'
import type { Point } from '@/lib/map-decks/decks'
import { carveTile, carvedAt, footprint, type Elevation } from './carve'

// About a metre in mercator units at New York's latitude.
const M = 1 / 30400000
const y0 = 0.3761
const x0 = 0.2944
const at = (east: number, north = 0): Point => [x0 + east * M, y0 - north * M]

describe('carvedAt', () => {
  // A cut running east, falling from 10 m to 5 m over 40 m between walls 12 m high; mercator y runs south, so its left is south.
  const tops: [number[], number[]] = [[12, 12, 12], [12, 12, 12]]
  const cut = footprint([at(0), at(20), at(40)], [10, 7.5, 5], tops, [3, 2], [3.5, 2.5], [6, 5])

  test('is the floor along the line, between its points', () => {
    expect(carvedAt(cut, at(10))).toBeCloseTo(8.75)
    expect(carvedAt(cut, at(30, 1))).toBeCloseTo(6.25)
  })

  test('reaches each side only as far as that side does', () => {
    expect(carvedAt(cut, at(10, -2.9))).toBeCloseTo(8.75)
    expect(carvedAt(cut, at(10, 2.4))).toBe(12)
    expect(carvedAt(cut, at(10, 5.5))).toBeNull()
  })

  test('banks up from each wall\'s shoulder', () => {
    expect(carvedAt(cut, at(10, 3.5))).toBeCloseTo(13)
  })

  test('stops square at its ends', () => {
    expect(carvedAt(cut, at(-0.5))).toBeNull()
    expect(carvedAt(cut, at(40.5))).toBeNull()
  })

  test('stays square at its start however wide it reaches round a bend', () => {
    const wide = footprint([at(0), at(3), at(6, 3)], [10, 10, 10], [[10, 10, 10], [10, 10, 10]], [2, 2], [2, 2], [12, 12])
    expect(carvedAt(wide, at(-3))).toBeNull()
  })
})

describe('carveTile', () => {
  /** A flat 64-pixel tile at 20 m, covering the cut, with its pixels in a plain array. */
  const tile = (): Elevation & { data: Float32Array } => {
    const [dim, border] = [64, 2]
    const stride = dim + 2 * border
    const data = new Float32Array(stride * stride).fill(20)
    const index = (x: number, y: number) => (y + border) * stride + x + border
    return { dim, border, data, get: (x, y) => data[index(x, y)], set: (x, y, m) => (data[index(x, y)] = m) }
  }
  // A z17 tile is about 230 m across here; take the one the cut lies in.
  const z = 17
  const id = (p: Point): [number, number, number] => [z, Math.floor(p[0] * 2 ** z), Math.floor(p[1] * 2 ** z)]

  test('lowers the ground under the cut to its floor and leaves the rest', () => {
    const t = tile()
    const cut = footprint([at(0), at(40)], [10, 10], [[10, 10], [10, 10]], [4, 4], [4, 4], [4, 4])
    expect(carveTile(t, id(at(20)), [cut])).toBe(true)
    expect(Math.min(...t.data)).toBe(10)
    expect(t.data.filter(h => h === 10).length).toBeLessThan(t.data.length / 4)
  })

  test('fills the ground up to a fill\'s floor, and never lowers it', () => {
    const t = tile()
    const over = footprint([at(0), at(40)], [25, 25], [[25, 25], [25, 25]], [4, 4], [4, 4], [6, 6], true)
    expect(carveTile(t, id(at(20)), [over])).toBe(true)
    expect(Math.max(...t.data)).toBe(25)
    expect(Math.min(...t.data)).toBe(20)
  })

  test('never raises the ground', () => {
    const t = tile()
    expect(carveTile(t, id(at(20)), [footprint([at(0), at(40)], [30, 30], [[30, 30], [30, 30]], [4, 4], [4, 4], [4, 4])])).toBe(false)
    expect(t.data.every(h => h === 20)).toBe(true)
  })
})
