/**
 * One rhythm for the whole sidebar, header to footer: a 40px row holding a
 * 20px icon, on a 4px grid. Every part of the kit reads its sizing from here
 * so a row, the logo and the account footer never drift apart.
 */

/** Expanded width, px, before the user has dragged it anywhere. */
export const SIDEBAR_WIDTH = 240
/** Drag-resize bounds for the expanded panel, px. */
export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 400
/** Drag this far inside the minimum and the panel collapses instead. */
export const SIDEBAR_COLLAPSE_SLACK = 44
/** Pointer travel before a press on the rail counts as a drag, not a click. */
export const SIDEBAR_DRAG_THRESHOLD = 3
/**
 * Icon-rail width, px. Deliberately `8px gutter + 8px row padding + 20px icon`
 * doubled: at this width a left-aligned row icon lands dead centre of the
 * rail, so rows never have to re-centre themselves as the sidebar collapses.
 */
export const SIDEBAR_WIDTH_ICON = 52

/**
 * Collapse/expand timing. The same deceleration curve `LeftSheet` uses, so
 * the two panels that flank the map feel like one mechanism.
 */
export const SIDEBAR_DURATION_MS = 220
export const SIDEBAR_EASING: [number, number, number, number] = [0.32, 0.72, 0, 1]

/** Row chrome, shared by menu rows and anything that has to line up with them. */
export const SIDEBAR_ROW =
  'h-10 rounded-md px-2 gap-2.5 text-sm font-medium transition-colors duration-150'
