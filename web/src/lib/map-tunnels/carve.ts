/**
 * Cuts carved into the terrain's elevation tiles, so the map drapes its own
 * ground, paths and paint down each cut's floor, and the ground filled back
 * up over a bore to meet its headwall.
 */
import { metresPerUnit, type Bounds, type Point } from '@/lib/map-decks/decks'

/**
 * A cut carved into the ground: its centreline, the floor along it, and the
 * top of each side's wall, in metres. The floor reaches `inner` metres out on
 * each side; past it the ground comes down to the wall's top, out to its
 * `shoulder`, and banks up from there to meet the ground by `outer`. A `fill`
 * raises the ground instead, to its floor, banking down past the shoulder.
 */
export type Footprint = { points: Point[]; floor: number[]; top: [number[], number[]]; inner: Sides; shoulder: Sides; outer: Sides; fill: boolean; bounds: Bounds }

type Sides = [number, number]

/** How steeply the ground banks up from a wall's shoulder, in metres per metre. */
export const BANK = 1

/** One tile's elevation pixels, `dim` a side, each at its top-left corner, with `border` more around them. */
export type Elevation = { dim: number; border: number; get: (x: number, y: number) => number; set: (x: number, y: number, metres: number) => void }

export function footprint(points: Point[], floor: number[], top: [number[], number[]], inner: Sides, shoulder: Sides, outer: Sides, fill = false): Footprint {
  const pad = Math.max(...outer) / metresPerUnit(points[0][1])
  const xs = points.map(p => p[0])
  const ys = points.map(p => p[1])
  return { points, floor, top, inner, shoulder, outer, fill, bounds: { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad } }
}

/** The height a point is carved to, or null where the cut does not reach it. */
export function carvedAt(f: Footprint, [x, y]: Point): number | null {
  const scale = metresPerUnit(y)
  const last = f.points.length - 2
  let best: { off: number; height: number } | null = null
  for (let i = 0; i <= last; i++) {
    const [a, b] = [f.points[i], f.points[i + 1]]
    const [ex, ey] = [b[0] - a[0], b[1] - a[1]]
    const length = Math.hypot(ex, ey)
    if (!length) continue
    let t = ((x - a[0]) * ex + (y - a[1]) * ey) / (length * length)
    // Only the joins between pieces are rounded; the ends are cut square.
    if ((i === 0 && t < 0) || (i === last && t > 1)) continue
    t = Math.max(0, Math.min(1, t))
    const [px, py] = [a[0] + ex * t, a[1] + ey * t]
    const side = ((x - px) * -ey + (y - py) * ex) / length >= 0 ? 0 : 1
    const off = Math.hypot(x - px, y - py) * scale
    if (off > f.outer[side] || (best && off >= best.off)) continue
    const along = (h: number[]) => h[i] + (h[i + 1] - h[i]) * t
    const height = off <= f.inner[side] ? along(f.floor) : along(f.top[side]) + Math.max(0, off - f.shoulder[side]) * BANK * (f.fill ? -1 : 1)
    best = { off, height }
  }
  return best?.height ?? null
}

/** Bring a tile's ground to every footprint over it, lowering or filling; whether anything changed. */
export function carveTile(tile: Elevation, [z, tx, ty]: [number, number, number], footprints: Footprint[]): boolean {
  const n = 2 ** z
  const { dim, border } = tile
  const pixel = (m: number, t: number) => (m * n - t) * dim
  let changed = false
  for (const f of footprints) {
    const { minX, minY, maxX, maxY } = f.bounds
    const [x0, x1] = [Math.max(-border, Math.floor(pixel(minX, tx))), Math.min(dim + border - 1, Math.ceil(pixel(maxX, tx)))]
    const [y0, y1] = [Math.max(-border, Math.floor(pixel(minY, ty))), Math.min(dim + border - 1, Math.ceil(pixel(maxY, ty)))]
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const height = carvedAt(f, [(tx + x / dim) / n, (ty + y / dim) / n])
        if (height === null || (f.fill ? height <= tile.get(x, y) : height >= tile.get(x, y))) continue
        tile.set(x, y, height)
        changed = true
      }
  }
  return changed
}
