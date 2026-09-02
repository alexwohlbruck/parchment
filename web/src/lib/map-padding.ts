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

/**
 * Re-express a viewport-space visible rect in a container's own coordinates.
 *
 * Obstruction bounds are collected with `getBoundingClientRect`, so they are
 * relative to the viewport. The map canvas, though, is a flex sibling of the
 * desktop sidebar: its origin is already inset by the sidebar's width. Handing
 * viewport coordinates to a container-sized padding calculation therefore
 * counts the sidebar twice, pushing the vanishing point right by its width —
 * and the sidebar is drag-resizable, so the error is not a fixed one.
 *
 * On mobile, where the map container fills the viewport, this is a no-op.
 */
export function toContainerRect(
  visibleArea: Rect,
  containerOrigin: { left: number; top: number },
): Rect {
  return {
    x: visibleArea.x - containerOrigin.left,
    y: visibleArea.y - containerOrigin.top,
    width: visibleArea.width,
    height: visibleArea.height,
  }
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
