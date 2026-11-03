/**
 * The ground under a landmark, filled in from the ground around it.
 *
 * Lidar bare earth keeps what it takes for ground: a podium, a grand stair,
 * a terrace, a theme park's rockwork. The model draws those itself, so the
 * terrain's copy of them pokes through it. Inside what the model covers, the
 * terrain is brought down to a smooth surface spanning the bare ground just
 * outside, so the site keeps its slope and loses the bump. Only ever down: a
 * sunk court or a bowl the DEM has right stays as it is.
 *
 * Worked out once per placement on the model's coverage grid (see
 * `landmark-coverage.ts`), then read into each elevation tile by position,
 * so neighbouring tiles agree at their seams whatever zoom they are.
 */
import type { Bounds, Point } from '@/lib/map-decks/decks'
import type { Coverage } from '@/lib/map-objects/landmark-coverage'
import type { Elevation } from './carve'

/** Metres past what the model covers that are filled too: lidar blurs a podium's edge over a pixel or two. */
export const FILL_MARGIN_M = 2

/** Ring samples the first guess is interpolated from. */
const GUESS_SAMPLES = 128

/** Relaxation sweeps toward the smooth (harmonic) surface, and their over-relaxation. */
const SWEEPS = 60
const OMEGA = 1.8

/**
 * Heights over a grid laid on the map: `inside` the cells filled, `heights`
 * their surface in true metres, and the ring of bare ground round them that
 * it was spanned from (NaN elsewhere). `toCell` takes a mercator point to
 * grid units (cell centres at +0.5), row-major as [a, b, c, d, e, f] for
 * i = a x + b y + c, j = d x + e y + f.
 */
export type GroundFill = { cols: number; rows: number; inside: Uint8Array; heights: Float32Array; toCell: number[]; bounds: Bounds }

/**
 * The fill under a model from its coverage. `toMap` takes a point of its
 * plan (model x, z) to mercator, `metres` is a model unit in metres, and
 * `bare` reads the unfilled DEM in true metres at a mercator point: null
 * while its tile loads, which makes this null too, NaN where there is none.
 * Null as well where nothing is covered.
 */
export function groundFill(
  coverage: Coverage,
  toMap: (x: number, z: number) => Point,
  metres: number,
  bare: (p: Point) => number | null,
): GroundFill | null {
  const { bounds: b, cell } = coverage
  const grow = Math.max(1, Math.ceil(FILL_MARGIN_M / (cell * metres)))
  // Room round the coverage for the margin and the ring.
  const pad = grow + 1
  const cols = coverage.cols + 2 * pad
  const rows = coverage.rows + 2 * pad
  const covered = new Uint8Array(cols * rows)
  for (let j = 0; j < coverage.rows; j++)
    for (let i = 0; i < coverage.cols; i++) if (coveredCell(coverage, i, j)) covered[(j + pad) * cols + i + pad] = 1
  const inside = dilate(covered, cols, rows, grow)
  const near = dilate(inside, cols, rows, 1)

  // Grid units on the map: cell (i, j) spans [i, i + 1] × [j, j + 1] from the padded grid's corner.
  const plan = (i: number, j: number): [number, number] => [b.minX + (i - pad) * cell, b.minZ + (j - pad) * cell]
  const [o, ex, ez] = [toMap(...plan(0, 0)), toMap(...plan(1, 0)), toMap(...plan(0, 1))]
  const toCell = invert(o, [ex[0] - o[0], ex[1] - o[1]], [ez[0] - o[0], ez[1] - o[1]])
  const point = (i: number, j: number): Point => [o[0] + (ex[0] - o[0]) * i + (ez[0] - o[0]) * j, o[1] + (ex[1] - o[1]) * i + (ez[1] - o[1]) * j]

  const heights = new Float32Array(cols * rows).fill(NaN)
  const ring: number[] = []
  let any = false
  for (let k = 0; k < near.length; k++) {
    if (inside[k]) {
      any = true
      continue
    }
    if (!near[k]) continue
    const h = bare(point((k % cols) + 0.5, Math.floor(k / cols) + 0.5))
    if (h === null) return null
    heights[k] = h
    if (Number.isFinite(h)) ring.push(k)
  }
  if (!any || !ring.length) return null

  guess(heights, inside, cols, ring)
  relax(heights, inside, cols, rows)

  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [i, j] of [[0, 0], [cols, 0], [0, rows], [cols, rows]]) {
    const [x, y] = point(i, j)
    minX = Math.min(minX, x), maxX = Math.max(maxX, x), minY = Math.min(minY, y), maxY = Math.max(maxY, y)
  }
  return { cols, rows, inside, heights, toCell, bounds: { minX, minY, maxX, maxY } }
}

function coveredCell({ sums, cols }: Coverage, i: number, j: number): boolean {
  const w = cols + 1
  return sums[(j + 1) * w + i + 1] - sums[j * w + i + 1] - sums[(j + 1) * w + i] + sums[j * w + i] > 0
}

/** Cells within `r` of a set one, square. */
function dilate(cells: Uint8Array, cols: number, rows: number, r: number): Uint8Array {
  const across = new Uint8Array(cells.length)
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (!cells[j * cols + i]) continue
      for (let x = Math.max(0, i - r); x <= Math.min(cols - 1, i + r); x++) across[j * cols + x] = 1
    }
  const out = new Uint8Array(cells.length)
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (!across[j * cols + i]) continue
      for (let y = Math.max(0, j - r); y <= Math.min(rows - 1, j + r); y++) out[y * cols + i] = 1
    }
  return out
}

/** The affine taking `o + i u + j v` back to (i, j). */
function invert(o: Point, u: Point, v: Point): number[] {
  const det = u[0] * v[1] - u[1] * v[0]
  const [a, b, d, e] = [v[1] / det, -v[0] / det, -u[1] / det, u[0] / det]
  return [a, b, -(a * o[0] + b * o[1]), d, e, -(d * o[0] + e * o[1])]
}

/**
 * A first surface inside: the plane through the ring, which keeps the
 * site's slope, plus the ring's departures from it, inverse-distance
 * weighted. Relaxing from here only has to settle the detail.
 */
function guess(heights: Float32Array, inside: Uint8Array, cols: number, ring: number[]) {
  const step = Math.max(1, ring.length / GUESS_SAMPLES)
  const picked = Array.from({ length: Math.min(ring.length, GUESS_SAMPLES) }, (_, n) => ring[Math.floor(n * step)])
  const pts = picked.map(k => [k % cols, Math.floor(k / cols), heights[k]])
  const plane = fitPlane(pts)
  const level = (i: number, j: number) => plane[0] + plane[1] * i + plane[2] * j
  const off = pts.map(([i, j, h]) => h - level(i, j))
  for (let k = 0; k < inside.length; k++) {
    if (!inside[k]) continue
    const [i, j] = [k % cols, Math.floor(k / cols)]
    let [sum, weights] = [0, 0]
    pts.forEach(([pi, pj], n) => {
      const w = 1 / ((pi - i) ** 2 + (pj - j) ** 2)
      sum += w * off[n]
      weights += w
    })
    heights[k] = level(i, j) + sum / weights
  }
}

/** Least squares h = c0 + c1 i + c2 j; level at the mean where the ring has no spread to tilt by. */
function fitPlane(pts: number[][]): [number, number, number] {
  const n = pts.length
  const [mi, mj, mh] = [0, 1, 2].map(c => pts.reduce((s, p) => s + p[c], 0) / n)
  let [sii, sij, sjj, sih, sjh] = [0, 0, 0, 0, 0]
  for (const [i, j, h] of pts) {
    const [di, dj, dh] = [i - mi, j - mj, h - mh]
    sii += di * di, sij += di * dj, sjj += dj * dj, sih += di * dh, sjh += dj * dh
  }
  const det = sii * sjj - sij * sij
  if (Math.abs(det) < 1e-9 * Math.max(1, sii * sjj)) return [mh, 0, 0]
  const c1 = (sih * sjj - sjh * sij) / det
  const c2 = (sjh * sii - sih * sij) / det
  return [mh - c1 * mi - c2 * mj, c1, c2]
}

/** Over-relaxed Gauss-Seidel toward each inside cell being its neighbours' mean, the ring held fixed. */
function relax(heights: Float32Array, inside: Uint8Array, cols: number, rows: number) {
  for (let sweep = 0; sweep < SWEEPS; sweep++)
    for (let j = 1; j < rows - 1; j++)
      for (let i = 1; i < cols - 1; i++) {
        const k = j * cols + i
        if (!inside[k]) continue
        let [sum, count] = [0, 0]
        for (const n of [k - 1, k + 1, k - cols, k + cols]) {
          const h = heights[n]
          if (h === h) sum += h, count++
        }
        if (count) heights[k] += OMEGA * (sum / count - heights[k])
      }
}

/** The fill's height at a mercator point, or null where it does not reach. */
export function fillAt(fill: GroundFill, [x, y]: Point): number | null {
  const { toCell: t, cols, rows, inside, heights } = fill
  const u = t[0] * x + t[1] * y + t[2]
  const v = t[3] * x + t[4] * y + t[5]
  return filledHeight(cols, rows, inside, heights, u, v)
}

function filledHeight(cols: number, rows: number, inside: Uint8Array, heights: Float32Array, u: number, v: number): number | null {
  const [i, j] = [Math.floor(u), Math.floor(v)]
  if (i < 0 || j < 0 || i >= cols || j >= rows || !inside[j * cols + i]) return null
  // Between cell centres; every neighbour of an inside cell is inside or on the ring.
  const [fu, fv] = [u - 0.5, v - 0.5]
  const [i0, j0] = [Math.floor(fu), Math.floor(fv)]
  const [tx, ty] = [fu - i0, fv - j0]
  let [sum, weights] = [0, 0]
  for (const [di, dj, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
    const [a, c] = [i0 + di, j0 + dj]
    if (a < 0 || c < 0 || a >= cols || c >= rows || !w) continue
    const h = heights[c * cols + a]
    if (h === h) sum += w * h, weights += w
  }
  return weights ? sum / weights : heights[j * cols + i]
}

/** Bring a tile's ground down to a fill wherever it reaches; whether anything changed. */
export function fillTile(tile: Elevation, [z, tx, ty]: [number, number, number], fill: GroundFill): boolean {
  const n = 2 ** z
  const { dim, border } = tile
  const { toCell: t, cols, rows, inside, heights, bounds } = fill
  // Pixel (x, y) stands at mercator ((tx + x / dim) / n, (ty + y / dim) / n).
  const px = (m: number, at: number) => (m * n - at) * dim
  const clamp = (v: number) => Math.max(-border, Math.min(dim + border - 1, v))
  const [x0, x1] = [clamp(Math.floor(px(bounds.minX, tx))), clamp(Math.ceil(px(bounds.maxX, tx)))]
  const [y0, y1] = [clamp(Math.floor(px(bounds.minY, ty))), clamp(Math.ceil(px(bounds.maxY, ty)))]
  if (px(bounds.maxX, tx) < -border || px(bounds.minX, tx) > dim + border || px(bounds.maxY, ty) < -border || px(bounds.minY, ty) > dim + border) return false
  let changed = false
  for (let y = y0; y <= y1; y++) {
    const my = (ty + y / dim) / n
    for (let x = x0; x <= x1; x++) {
      const mx = (tx + x / dim) / n
      const h = filledHeight(cols, rows, inside, heights, t[0] * mx + t[1] * my + t[2], t[3] * mx + t[4] * my + t[5])
      if (h === null || !(h < tile.get(x, y))) continue
      tile.set(x, y, h)
      changed = true
    }
  }
  return changed
}
