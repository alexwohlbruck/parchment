import type { Rect } from '@/lib/map/map-padding'

export interface Point {
  x: number
  y: number
}

export interface EdgeHint extends Point {
  /** Radians, pointing from the hint toward the off-screen point. */
  angle: number
}

function contains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/**
 * Where to pin a hint for a point outside `area`: on the edge of `area` inset
 * by `inset`, along the line from the area's centre toward the point. Null
 * while the point is inside `area`, or when the area is too small to hold one.
 */
export function edgeHint(
  point: Point,
  area: Rect,
  inset: number,
): EdgeHint | null {
  if (contains(area, point)) return null

  const halfW = area.width / 2 - inset
  const halfH = area.height / 2 - inset
  if (halfW <= 0 || halfH <= 0) return null

  const cx = area.x + area.width / 2
  const cy = area.y + area.height / 2
  const dx = point.x - cx
  const dy = point.y - cy
  const scale = Math.min(
    dx ? halfW / Math.abs(dx) : Infinity,
    dy ? halfH / Math.abs(dy) : Infinity,
  )

  return {
    x: cx + dx * scale,
    y: cy + dy * scale,
    angle: Math.atan2(dy, dx),
  }
}

export function intersectRect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  }
}
