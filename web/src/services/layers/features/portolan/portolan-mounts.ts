/**
 * Which feed pyramids are on the map. A feed the viewport has left stays
 * mounted, tiles and all, so coming back draws it from memory.
 */
import type { PortolanIndexEntry } from '@/types/portolan.types'

export interface Viewport {
  w: number
  s: number
  e: number
  n: number
}

/** Mount a pyramid once the viewport is within this fraction of its own span of it. */
const MOUNT_PAD = 0.25

/** Feeds wanted for one viewport. Midtown Manhattan alone touches 17. */
export const MAX_MOUNTED = 24

/** Feeds kept mounted in total, counting the ones the viewport has left. */
export const MAX_KEPT = 40

function padded(v: Viewport, pad: number): Viewport {
  const w = v.e - v.w
  const h = v.n - v.s
  return { w: v.w - w * pad, e: v.e + w * pad, s: v.s - h * pad, n: v.n + h * pad }
}

// No bounds recorded: it could be anywhere, so never cull it.
const hits = (box: number[] | undefined, v: Viewport) =>
  !box || box.length !== 4 || (box[0] <= v.e && box[2] >= v.w && box[1] <= v.n && box[3] >= v.s)

/** Squared distance from the viewport's centre to a feed's bounds; 0 inside them. */
function distance(box: number[] | undefined, v: Viewport): number {
  if (!box || box.length !== 4) return 0
  const cx = (v.w + v.e) / 2
  const cy = (v.s + v.n) / 2
  const dx = Math.max(box[0] - cx, 0, cx - box[2])
  const dy = Math.max(box[1] - cy, 0, cy - box[3])
  return dx * dx + dy * dy
}

export function planMounts(
  regions: PortolanIndexEntry[],
  view: Viewport,
  mounted: ReadonlySet<string>,
): { want: PortolanIndexEntry[]; drop: string[] } {
  const near = padded(view, MOUNT_PAD)
  const want = regions
    .filter(r => hits(r.bounds, near))
    .map(r => ({ r, d: distance(r.bounds, view) }))
    .sort((a, z) => a.d - z.d)
    .slice(0, MAX_MOUNTED)
    .map(x => x.r)

  const wanted = new Set(want.map(r => r.feed))
  const byFeed = new Map(regions.map(r => [r.feed, r]))
  const spare = [...mounted]
    .filter(feed => !wanted.has(feed))
    .map(feed => ({ feed, d: byFeed.has(feed) ? distance(byFeed.get(feed)!.bounds, view) : Infinity }))
    .sort((a, z) => z.d - a.d)
  const fresh = want.filter(r => !mounted.has(r.feed)).length
  const excess = Math.max(0, mounted.size + fresh - MAX_KEPT)
  const drop = spare.filter((s, i) => i < excess || s.d === Infinity).map(s => s.feed)
  return { want, drop }
}
