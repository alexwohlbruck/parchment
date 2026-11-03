export interface ScreenPoint {
  x: number
  y: number
}

/** Which points survive, taken in priority order, so no two kept ones are nearer than `minPx`. */
export function declutter(points: ScreenPoint[], minPx: number): boolean[] {
  const kept: ScreenPoint[] = []
  return points.map(point => {
    const crowded = kept.some(other => Math.hypot(other.x - point.x, other.y - point.y) < minPx)
    if (!crowded) kept.push(point)
    return !crowded
  })
}

export interface ScreenBox {
  left: number
  top: number
  right: number
  bottom: number
}

/** Whether two boxes come within `margin` px of each other. */
export function boxesCrowd(a: ScreenBox, b: ScreenBox, margin = 0): boolean {
  return a.left - margin < b.right && b.left - margin < a.right && a.top - margin < b.bottom && b.top - margin < a.bottom
}
