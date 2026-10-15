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

/** Whether a point lies past either end of a footprint, which are cut square; only the joins between its pieces are rounded. */
function beyondEnds({ points }: Footprint, x: number, y: number): boolean {
  const past = (a: Point, b: Point) => (x - a[0]) * (a[0] - b[0]) + (y - a[1]) * (a[1] - b[1]) > 0
  return past(points[0], points[1]) || past(points[points.length - 1], points[points.length - 2])
}

/** The height `off` metres to one `side` of a footprint, `t` of the way along its piece `i`. */
function heightAt(f: Footprint, i: number, t: number, off: number, side: 0 | 1): number {
  const along = (h: number[]) => h[i] + (h[i + 1] - h[i]) * t
  return off <= f.inner[side] ? along(f.floor) : along(f.top[side]) + Math.max(0, off - f.shoulder[side]) * BANK * (f.fill ? -1 : 1)
}

/** The height a point is carved to, or null where the cut does not reach it. */
export function carvedAt(f: Footprint, [x, y]: Point): number | null {
  if (beyondEnds(f, x, y)) return null
  const scale = metresPerUnit(y)
  let best = Infinity
  let height: number | null = null
  for (let i = 0; i < f.points.length - 1; i++) {
    const [a, b] = [f.points[i], f.points[i + 1]]
    const [ex, ey] = [b[0] - a[0], b[1] - a[1]]
    const length = Math.hypot(ex, ey)
    if (!length) continue
    const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / (length * length)))
    const [dx, dy] = [x - a[0] - ex * t, y - a[1] - ey * t]
    const side = dx * -ey + dy * ex >= 0 ? 0 : 1
    const off = Math.hypot(dx, dy) * scale
    if (off > f.outer[side] || off >= best) continue
    best = off
    height = heightAt(f, i, t, off, side)
  }
  return height
}

/** Bring a tile's ground to every footprint over it, lowering or filling; whether anything changed. */
export function carveTile(tile: Elevation, [z, tx, ty]: [number, number, number], footprints: Footprint[]): boolean {
  const n = 2 ** z
  const { dim, border } = tile
  // Work in the tile's pixels: a footprint's line moved into them, and its reach in pixels.
  const toPixel = ([x, y]: Point): Point => [(x * n - tx) * dim, (y * n - ty) * dim]
  const clamp = (v: number) => Math.max(-border, Math.min(dim + border - 1, v))
  let changed = false
  for (const f of footprints) {
    const pts = f.points.map(toPixel)
    const metres = metresPerUnit(f.points[0][1]) / (n * dim)
    const reach = Math.max(...f.outer) / metres
    const xs = pts.map(p => p[0])
    const ys = pts.map(p => p[1])
    const [x0, x1] = [clamp(Math.floor(Math.min(...xs) - reach)), clamp(Math.ceil(Math.max(...xs) + reach))]
    const [y0, y1] = [clamp(Math.floor(Math.min(...ys) - reach)), clamp(Math.ceil(Math.max(...ys) + reach))]
    if (x0 > x1 || y0 > y1 || Math.max(...xs) + reach < -border || Math.min(...xs) - reach > dim + border || Math.max(...ys) + reach < -border || Math.min(...ys) - reach > dim + border) continue
    const w = x1 - x0 + 1
    const best = new Float32Array(w * (y1 - y0 + 1)).fill(Infinity)
    const height = new Float32Array(best.length)
    const [s0, s1, e0, e1] = [pts[0], pts[1], pts[pts.length - 1], pts[pts.length - 2]]
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i]
      const [ex, ey] = [pts[i + 1][0] - ax, pts[i + 1][1] - ay]
      const length2 = ex * ex + ey * ey
      if (!length2) continue
      const ya = clamp(Math.floor(Math.min(ay, ay + ey) - reach))
      const yb = clamp(Math.ceil(Math.max(ay, ay + ey) + reach))
      const xa = clamp(Math.floor(Math.min(ax, ax + ex) - reach))
      const xb = clamp(Math.ceil(Math.max(ax, ax + ex) + reach))
      for (let y = ya; y <= yb; y++)
        for (let x = xa; x <= xb; x++) {
          if ((x - s0[0]) * (s0[0] - s1[0]) + (y - s0[1]) * (s0[1] - s1[1]) > 0) continue
          if ((x - e0[0]) * (e0[0] - e1[0]) + (y - e0[1]) * (e0[1] - e1[1]) > 0) continue
          let t = ((x - ax) * ex + (y - ay) * ey) / length2
          t = t < 0 ? 0 : t > 1 ? 1 : t
          const dx = x - ax - ex * t
          const dy = y - ay - ey * t
          const off = Math.sqrt(dx * dx + dy * dy) * metres
          const k = (y - y0) * w + (x - x0)
          if (off >= best[k]) continue
          const side = dx * -ey + dy * ex >= 0 ? 0 : 1
          if (off > f.outer[side]) continue
          best[k] = off
          height[k] = heightAt(f, i, t, off, side)
        }
    }
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const k = (y - y0) * w + (x - x0)
        if (best[k] === Infinity) continue
        const ground = tile.get(x, y)
        if (f.fill ? height[k] <= ground : height[k] >= ground) continue
        tile.set(x, y, height[k])
        changed = true
      }
  }
  return changed
}
