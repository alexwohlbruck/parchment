/**
 * Shared helpers for computing `fitBounds` padding on the map.
 *
 * The returned padding combines two concerns:
 *   1. Obstruction awareness — the drawer / bottom sheet / UI chrome carves
 *      an unoccluded rectangle out of the viewport. The fitted content
 *      should land inside that rectangle, so each side of the padding
 *      includes the occluded gutter on that side.
 *   2. Breathing room — a scaled margin proportional to viewport size so
 *      small screens don't surrender most of their usable area to padding
 *      while large screens don't end up with the route glued to the edges.
 *      X and Y scale independently because obstruction geometry and
 *      content shape tend to differ along each axis (side drawers are
 *      tall and narrow; bottom sheets are wide and short).
 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Padding {
  top: number
  right: number
  bottom: number
  left: number
}

const MARGIN_X_FRACTION = 0.05 // 5% of viewport width per side
const MARGIN_Y_FRACTION = 0.08 // 8% of viewport height per side
const MIN_MARGIN = 16
const MAX_MARGIN = 100

export function calculateFitPadding(
  visibleArea: Rect,
  viewportWidth: number,
  viewportHeight: number,
): Padding {
  const clamp = (v: number) =>
    Math.max(MIN_MARGIN, Math.min(MAX_MARGIN, v))
  const marginX = clamp(viewportWidth * MARGIN_X_FRACTION)
  const marginY = clamp(viewportHeight * MARGIN_Y_FRACTION)

  const leftGutter = Math.max(0, visibleArea.x)
  const topGutter = Math.max(0, visibleArea.y)
  const rightGutter = Math.max(
    0,
    viewportWidth - (visibleArea.x + visibleArea.width),
  )
  const bottomGutter = Math.max(
    0,
    viewportHeight - (visibleArea.y + visibleArea.height),
  )

  return {
    left: leftGutter + marginX,
    top: topGutter + marginY,
    right: rightGutter + marginX,
    bottom: bottomGutter + marginY,
  }
}
