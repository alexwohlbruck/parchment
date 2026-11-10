/**
 * The ground a bridge rises with as the map exaggerates terrain, as Barrelman
 * bakes it into each deck's `lift` (`liftField` in its `bridge-mesh/encode.ts`),
 * so a landmark bridge and the map's road on it stay together. Must match it
 * exactly.
 */
import type { Point } from './decks'

/** Mercator units between the field's nodes: 25 m at the equator. */
const DATUM_CELL = 25 / 40075016.686

/** Cells read each side of a node, at half-cell steps. */
const DATUM_READ = 2

/** Metres above the ground over which a structure goes from following it to the smoothed ground. */
export const LIFT_BLEND = 6

/** Past any lattice index across the world, so a pair of them packs into one number. */
const KEY = 2 ** 23

/** Uniform cubic B-spline weights at t in [0, 1) for the four nodes around it, into `w`. */
function spline(t: number, w: Float64Array) {
  w[0] = (1 - t) ** 3 / 6
  w[1] = (3 * t ** 3 - 6 * t ** 2 + 4) / 6
  w[2] = (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6
  w[3] = t ** 3 / 6
}

/**
 * The smoothed ground at mercator points, from `at`, the raw DEM in metres
 * (null or NaN where unknown); null where a node around a point has none.
 * A structure LIFT_BLEND metres or more above the ground rises with it; below
 * that it is mixed toward the ground itself, so its feet stay on it.
 */
export function smoothedGround(at: (point: Point) => number | null): (point: Point) => number | null {
  // Every node reads the same half-cell lattice, so each lattice point is read once.
  const samples = new Map<number, number | null>()
  const sample = (m: number, n: number) => {
    const key = m * KEY + n
    let h = samples.get(key)
    if (h === undefined) samples.set(key, (h = at([(m / 2) * DATUM_CELL, (n / 2) * DATUM_CELL])))
    return h
  }
  const read = new Float64Array((4 * DATUM_READ + 1) ** 2)
  const nodes = new Map<number, number | null>()
  const node = (i: number, j: number): number | null => {
    const key = i * KEY + j
    let median = nodes.get(key)
    if (median === undefined) {
      let count = 0
      for (let a = -2 * DATUM_READ; a <= 2 * DATUM_READ; a++)
        for (let b = -2 * DATUM_READ; b <= 2 * DATUM_READ; b++) {
          const h = sample(2 * i + a, 2 * j + b)
          if (h !== null && Number.isFinite(h)) read[count++] = h
        }
      median = count ? read.subarray(0, count).sort()[count >> 1] : null
      nodes.set(key, median)
    }
    return median
  }
  // Points come in runs through one cell, so the last cell's nodes are kept.
  let cell = NaN
  const around: Array<number | null> = []
  const [wx, wy] = [new Float64Array(4), new Float64Array(4)]
  return ([x, y]) => {
    const fx = x / DATUM_CELL
    const fy = y / DATUM_CELL
    const i = Math.floor(fx)
    const j = Math.floor(fy)
    if (i * KEY + j !== cell) {
      cell = i * KEY + j
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) around[a * 4 + b] = node(i + a - 1, j + b - 1)
    }
    spline(fx - i, wx)
    spline(fy - j, wy)
    let sum = 0
    for (let a = 0; a < 4; a++)
      for (let b = 0; b < 4; b++) {
        const h = around[a * 4 + b]
        if (h === null) return null
        sum += h * wx[a] * wy[b]
      }
    return sum
  }
}
