import { describe, test, expect } from 'vitest'
import type { Point } from '@/lib/map-decks/decks'
import { carvePads, pad, paddedAt, padHeight, padSamples } from './pad'
import type { Elevation } from './carve'

// About a metre in mercator units at New York's latitude.
const M = 1 / 30400000
const [x0, y0] = [0.2944, 0.3761]
const at = (east: number, north = 0): Point => [x0 + east * M, y0 - north * M]
/** A 40 m square, its corner at the origin. */
const square = [at(0), at(40), at(40, 40), at(0, 40)]

describe('paddedAt', () => {
  const venue = pad(square, 10, 2)

  test('is the pad\'s height inside it and just past its outline', () => {
    expect(paddedAt(venue, at(20, 20), 14)).toBe(10)
    expect(paddedAt(venue, at(41.5, 20), 14)).toBe(10)
  })

  test('banks back to the ground beyond the margin, up or down', () => {
    expect(paddedAt(venue, at(52, 20), 20)).toBeCloseTo(14)
    expect(paddedAt(venue, at(52, 20), 5)).toBeCloseTo(6)
    expect(paddedAt(venue, at(52, 20), 11)).toBe(11)
  })

  test('leaves the ground alone past its reach', () => {
    expect(paddedAt(venue, at(150, 20), 50)).toBe(50)
  })
})

describe('padHeight', () => {
  test('sits low in the ground sampled, ignoring a stray pit and gaps', () => {
    const ground = [-40, ...Array.from({ length: 19 }, (_, i) => 10 + i), NaN]
    expect(padHeight(ground)).toBe(12)
  })

  test('is null with nothing sampled', () => {
    expect(padHeight([NaN])).toBeNull()
  })
})

describe('padSamples', () => {
  test('keeps to the inside of the outline', () => {
    const triangle = [at(0), at(40), at(0, 40)]
    const samples = padSamples(triangle)
    expect(samples.length).toBeGreaterThan(50)
    expect(samples.every(([x, y]) => (x - x0) / M + (y0 - y) / M <= 40 + 1e-6)).toBe(true)
  })
})

describe('carvePads', () => {
  /** A 128-pixel tile sloping 0.2 m a pixel eastward, with its pixels in a plain array. */
  const tile = (): Elevation & { data: Float32Array; at: (x: number, y: number) => number } => {
    const [dim, border] = [128, 2]
    const stride = dim + 2 * border
    const data = new Float32Array(stride * stride)
    for (let y = -border; y < dim + border; y++) for (let x = -border; x < dim + border; x++) data[(y + border) * stride + x + border] = 20 + x * 0.2
    const index = (x: number, y: number) => (y + border) * stride + x + border
    return { dim, border, data, at: (x, y) => data[index(x, y)], get: (x, y) => data[index(x, y)], set: (x, y, m) => (data[index(x, y)] = m) }
  }
  // A z16 tile is about 460 m across here, 3.6 m a pixel at 128 pixels.
  const z = 16
  const id = (p: Point): [number, number, number] => [z, Math.floor(p[0] * 2 ** z), Math.floor(p[1] * 2 ** z)]
  const pixel = (t: [number, number, number], p: Point) => [Math.round((p[0] * 2 ** z - t[1]) * 128), Math.round((p[1] * 2 ** z - t[2]) * 128)]

  test('levels the ground under a venue to one height, whatever the slope', () => {
    const t = tile()
    const tileId = id(at(20, 20))
    expect(carvePads(t, tileId, [pad(square, 15)])).toBe(true)
    const heights = [at(1, 1), at(20, 20), at(39, 39), at(39, 1)].map(p => t.at(...(pixel(tileId, p) as [number, number])))
    expect(heights.every(h => h === 15)).toBe(true)
  })

  test('meets the natural ground again past its reach', () => {
    const t = tile()
    const tileId = id(at(20, 20))
    const [fx, fy] = pixel(tileId, at(150, 20))
    const before = t.at(fx, fy)
    carvePads(t, tileId, [pad(square, 15)])
    expect(t.at(fx, fy)).toBe(before)
  })

  test('changes nothing where the ground is already at the pad\'s height everywhere it reaches', () => {
    const t = tile()
    t.data.fill(15)
    expect(carvePads(t, id(at(20, 20)), [pad(square, 15)])).toBe(false)
  })

  test('keeps each of two touching venues flat', () => {
    const t = tile()
    const tileId = id(at(20, 20))
    const next = [at(40), at(80), at(80, 40), at(40, 40)]
    carvePads(t, tileId, [pad(square, 15), pad(next, 25)])
    expect(t.at(...(pixel(tileId, at(30, 20)) as [number, number]))).toBe(15)
    expect(t.at(...(pixel(tileId, at(50, 20)) as [number, number]))).toBe(25)
  })

  test('leaves a tile too coarse to level alone', () => {
    const t = tile()
    const coarse: [number, number, number] = [10, Math.floor(x0 * 2 ** 10), Math.floor(y0 * 2 ** 10)]
    expect(carvePads(t, coarse, [pad(square, 15)])).toBe(false)
  })

  test('leaves a tile it does not reach alone', () => {
    const t = tile()
    const far = id(at(5000, 5000))
    expect(carvePads(t, far, [pad(square, 15)])).toBe(false)
  })
})
