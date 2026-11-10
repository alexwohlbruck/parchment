import { describe, expect, it } from 'vitest'
import type { Point } from './decks'
import { smoothedGround } from './lift-field'

/** Barrelman's `liftField` (src/lib/bridge-mesh/encode.ts), verbatim: what the map's decks are baked with. */
function barrelmanLiftField(at: (point: Point) => number | null) {
  const DATUM_CELL = 25 / 40075016.686
  const DATUM_READ = 2
  const LIFT_BLEND = 6
  const spline = (t: number) => [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t ** 2 + 4) / 6, (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6, t ** 3 / 6]
  const nodes = new Map<string, number | null>()
  const offsets = Array.from({ length: 4 * DATUM_READ + 1 }, (_, k) => k / 2 - DATUM_READ)
  const node = (i: number, j: number): number | null => {
    const key = `${i},${j}`
    if (!nodes.has(key)) {
      const heights = offsets.flatMap(dx => offsets.map(dy => at([(i + dx) * DATUM_CELL, (j + dy) * DATUM_CELL])))
        .filter((h): h is number => h !== null && Number.isFinite(h)).sort((a, b) => a - b)
      nodes.set(key, heights.length ? heights[heights.length >> 1] : null)
    }
    return nodes.get(key)!
  }
  const datum = ([x, y]: Point): number | null => {
    const [fx, fy] = [x / DATUM_CELL, y / DATUM_CELL]
    const [i, j] = [Math.floor(fx), Math.floor(fy)]
    const [wx, wy] = [spline(fx - i), spline(fy - j)]
    let sum = 0
    for (let a = 0; a < 4; a++)
      for (let b = 0; b < 4; b++) {
        const h = node(i + a - 1, j + b - 1)
        if (h === null) return null
        sum += h * wx[a] * wy[b]
      }
    return sum
  }
  return (p: Point, z: number, ground: number | null): number => {
    const smooth = datum(p)
    if (ground === null || smooth === null) return z
    const w = Math.min(1, Math.max(0, 1 - (z - ground) / LIFT_BLEND))
    return smooth + (ground - smooth) * w
  }
}

/** Mercator units per metre near San Diego. */
const UNIT = 1 / (40075016.686 * Math.cos((32.73 * Math.PI) / 180))
const ORIGIN: Point = [0.17457, 0.40577]

/** A canyon 41 m deep at its floor, rising to 76 m rims 150 m either side, with a stream cut in it. */
const canyon = ([x]: Point) => {
  const east = (x - ORIGIN[0]) / UNIT
  const stream = Math.abs(east) < 3 ? -2 : 0
  return 41 + 35 * Math.min(1, (east / 150) ** 2) + stream
}

describe('smoothedGround', () => {
  it('is the smoothed ground Barrelman lifts decks by', () => {
    const ours = smoothedGround(canyon)
    const theirs = barrelmanLiftField(canyon)
    for (let east = -300; east <= 300; east += 7.3)
      for (const south of [-20, 0, 13]) {
        const p: Point = [ORIGIN[0] + east * UNIT, ORIGIN[1] + south * UNIT]
        // Well above the ground, a deck takes the smoothed ground alone.
        expect(ours(p)).toBe(theirs(p, 1000, canyon(p)))
      }
  })

  it('knows no ground where no node has any', () => {
    expect(smoothedGround(() => null)(ORIGIN)).toBeNull()
    expect(smoothedGround(() => NaN)(ORIGIN)).toBeNull()
  })
})
