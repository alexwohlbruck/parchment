/** Ground levelled under an outline: flat to it and a margin past it, banking back to the natural ground beyond. */
import { boundsOf, metresPerUnit, type Bounds, type Point } from '@/lib/map-decks/decks'
import type { Elevation } from './carve'

/** A convex `ring` (open, in mercator units) levelled to `height`, flat `edge` metres past it, banked back to the ground by `reach`. */
export type Pad = { ring: Point[]; height: number; edge: number; reach: number; bounds: Bounds }

/** How steeply the ground banks back from a pad, in metres per metre: gently, so streets crossing it read as graded rather than broken. */
const BANK = 0.4
/** Metres past the flat margin a bank has to meet the ground in. */
const BANK_REACH = 60
/** Pixels past an outline always kept flat, so terrain sampled near its edge never reads the bank. */
const EDGE_PIXELS = 1.5
/** Metres a pixel past which a tile is too coarse to level: its flat margin would swallow the ground around. */
const COARSEST_PIXEL = 8
/** How far up the ground sampled under a pad its height is taken: low, so a floor sinks a little rather than floats. */
const PAD_QUANTILE = 0.2
const SAMPLE_GRID = 16

export function pad(ring: Point[], height: number, edge = 2): Pad {
  const reach = edge + BANK_REACH
  return { ring, height, edge, reach, bounds: boundsOf(ring, reach) }
}

function levelled({ height }: Pad, off: number, edge: number, ground: number): number {
  if (off <= edge) return height
  const rise = (off - edge) * BANK
  return ground > height ? Math.min(ground, height + rise) : Math.max(ground, height - rise)
}

/** Distance from a point to a segment, in the units given. */
function toSegment([x, y]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const [ex, ey] = [bx - ax, by - ay]
  const length2 = ex * ex + ey * ey
  const t = length2 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / length2)) : 0
  return Math.hypot(x - ax - ex * t, y - ay - ey * t)
}

/** Where a row crosses a convex ring, as the span of x inside it; null where it misses. */
function rowSpan(ring: Point[], y: number): [number, number] | null {
  let [lo, hi] = [Infinity, -Infinity]
  for (let i = 0; i < ring.length; i++) {
    const [[ax, ay], [bx, by]] = [ring[i], ring[(i + 1) % ring.length]]
    if (ay === by || (ay - y) * (by - y) > 0) continue
    const x = ax + ((y - ay) / (by - ay)) * (bx - ax)
    lo = Math.min(lo, x)
    hi = Math.max(hi, x)
  }
  return lo <= hi ? [lo, hi] : null
}

function inside(ring: Point[], [x, y]: Point): boolean {
  const span = rowSpan(ring, y)
  return !!span && x >= span[0] && x <= span[1]
}

/** Metres from a point to a pad's outline, 0 within it. */
function offOutline(p: Pad, point: Point): number {
  if (inside(p.ring, point)) return 0
  let best = Infinity
  for (let i = 0; i < p.ring.length; i++) best = Math.min(best, toSegment(point, p.ring[i], p.ring[(i + 1) % p.ring.length]))
  return best * metresPerUnit(point[1])
}

/** The ground a pad leaves at a point whose natural ground is `ground`. */
export function paddedAt(p: Pad, point: Point, ground: number): number {
  const off = offOutline(p, point)
  return off > p.reach ? ground : levelled(p, off, p.edge, ground)
}

/** Points to sample a ring's ground at: its corners and a grid over its inside. */
export function padSamples(ring: Point[]): Point[] {
  const b = boundsOf(ring)
  const points = [...ring]
  for (let i = 0; i < SAMPLE_GRID; i++)
    for (let j = 0; j < SAMPLE_GRID; j++) {
      const at: Point = [b.minX + ((i + 0.5) / SAMPLE_GRID) * (b.maxX - b.minX), b.minY + ((j + 0.5) / SAMPLE_GRID) * (b.maxY - b.minY)]
      if (inside(ring, at)) points.push(at)
    }
  return points
}

/** The height to level a pad to from the ground sampled over it; null with nothing sampled. */
export function padHeight(samples: number[]): number | null {
  const known = samples.filter(Number.isFinite).sort((a, b) => a - b)
  return known.length ? known[Math.floor((known.length - 1) * PAD_QUANTILE)] : null
}

/** Each pixel's distance in pixels to a pad's outline, 0 inside, Infinity past its reach, over the window it reaches in the tile. */
function distances(pts: Point[], reach: number, dim: number, border: number) {
  const clamp = (v: number) => Math.max(-border, Math.min(dim + border - 1, v))
  const xs = pts.map(p => p[0])
  const ys = pts.map(p => p[1])
  const [x0, x1] = [clamp(Math.floor(Math.min(...xs) - reach)), clamp(Math.ceil(Math.max(...xs) + reach))]
  const [y0, y1] = [clamp(Math.floor(Math.min(...ys) - reach)), clamp(Math.ceil(Math.max(...ys) + reach))]
  if (Math.max(...xs) + reach < -border || Math.min(...xs) - reach > dim + border || Math.max(...ys) + reach < -border || Math.min(...ys) - reach > dim + border) return null
  const w = x1 - x0 + 1
  const dist = new Float32Array(w * (y1 - y0 + 1)).fill(Infinity)
  for (let y = y0; y <= y1; y++) {
    const span = rowSpan(pts, y)
    if (span) for (let x = Math.max(x0, Math.ceil(span[0])); x <= Math.min(x1, Math.floor(span[1])); x++) dist[(y - y0) * w + x - x0] = 0
  }
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]]
    const ey = b[1] - a[1]
    for (let y = clamp(Math.floor(Math.min(a[1], b[1]) - reach)); y <= clamp(Math.ceil(Math.max(a[1], b[1]) + reach)); y++) {
      // Only the stretch of the edge within `reach` of this row can be within reach of its pixels.
      let [t0, t1] = ey ? [(y - reach - a[1]) / ey, (y + reach - a[1]) / ey].sort((p, q) => p - q) : [0, 1]
      ;[t0, t1] = [Math.max(0, t0), Math.min(1, t1)]
      if (t0 > t1) continue
      const [xa, xb] = [a[0] + (b[0] - a[0]) * t0, a[0] + (b[0] - a[0]) * t1]
      for (let x = clamp(Math.floor(Math.min(xa, xb) - reach)); x <= clamp(Math.ceil(Math.max(xa, xb) + reach)); x++) {
        const k = (y - y0) * w + x - x0
        if (dist[k] === 0) continue
        const d = toSegment([x, y], a, b)
        if (d < dist[k]) dist[k] = d
      }
    }
  }
  return { x0, y0, x1, y1, w, dist }
}

/** Level a tile's ground under every pad over it; whether anything changed. Banks go first, so where pads meet each keeps its floor flat. */
export function carvePads(tile: Elevation, [z, tx, ty]: [number, number, number], pads: Pad[]): boolean {
  const n = 2 ** z
  const { dim, border } = tile
  const reached = pads.flatMap(p => {
    const metres = metresPerUnit(p.ring[0][1]) / (n * dim)
    if (metres > COARSEST_PIXEL) return []
    const edge = Math.max(p.edge, EDGE_PIXELS * metres)
    const window = distances(p.ring.map(([x, y]) => [(x * n - tx) * dim, (y * n - ty) * dim]), Math.max(p.reach, edge) / metres, dim, border)
    return window ? [{ p, metres, edge, window }] : []
  })
  let changed = false
  for (const flat of [false, true])
    for (const { p, metres, edge, window: { x0, y0, x1, y1, w, dist } } of reached)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const off = dist[(y - y0) * w + x - x0] * metres
          if (off > Math.max(p.reach, edge) || off <= edge !== flat) continue
          const ground = tile.get(x, y)
          const height = levelled(p, off, edge, ground)
          if (Math.abs(height - ground) < 0.01) continue
          tile.set(x, y, height)
          changed = true
        }
  return changed
}
