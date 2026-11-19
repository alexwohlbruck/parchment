/**
 * Snap-point arithmetic for the bottom sheet.
 *
 * Vaul takes points as a pixel string, a 0-1 viewport fraction, or a raw
 * pixel number, and its drag maths assumes they ascend. These rules keep that
 * true while the peek detent is measured from live content.
 */
export type SnapPoint = number | string

/** Minimum gap kept between the peek and the detent above it. */
const PEEK_GAP_PX = 24

export function snapPointToPixels(
  point: SnapPoint,
  viewportHeight: number,
): number {
  if (typeof point === 'string') return parseFloat(point)
  if (point > 0 && point <= 1) return viewportHeight * point
  return point
}

/** Grow a point by pixels, preserving whichever format it arrived in. */
export function addPixels(
  point: SnapPoint,
  px: number,
  viewportHeight: number,
): SnapPoint {
  if (px <= 0) return point
  if (typeof point === 'string') {
    return point.endsWith('px') ? `${parseFloat(point) + px}px` : point
  }
  if (point > 0 && point <= 1) {
    return (point * viewportHeight + px) / viewportHeight
  }
  return point + px
}

/**
 * Keep a measured detent strictly between its neighbours. On a short screen
 * tall content would otherwise overshoot and break the ascending order.
 */
export function clampPeek(
  point: SnapPoint,
  nextPoint: SnapPoint | undefined,
  viewportHeight: number,
  prevPoint?: SnapPoint,
): SnapPoint {
  if (typeof point !== 'string' || !point.endsWith('px')) return point
  let px = parseFloat(point)
  if (nextPoint !== undefined) {
    const max = snapPointToPixels(nextPoint, viewportHeight) - PEEK_GAP_PX
    if (max > 0) px = Math.min(px, max)
  }
  if (prevPoint !== undefined) {
    px = Math.max(px, snapPointToPixels(prevPoint, viewportHeight) + PEEK_GAP_PX)
  }
  return `${px}px`
}

export interface SafeAreaInsets {
  top: number
  bottom: number
}

/** Full height clears the notch; the peek clears the home indicator. */
export function adjustForSafeArea(
  point: SnapPoint,
  index: number,
  insets: SafeAreaInsets,
  viewportHeight: number,
): SnapPoint {
  if (point === 1 && insets.top > 0) {
    return (viewportHeight - insets.top) / viewportHeight
  }
  if (index === 0) return addPixels(point, insets.bottom, viewportHeight)
  return point
}

/**
 * The final list handed to Vaul: the measured peek swapped into its slot
 * (`measuredIndex`, the first by default), safe-area adjusted, then clamped.
 * `lift` raises every detent by that many pixels, for a sheet that floats
 * above the bottom edge.
 */
export function resolveSnapPoints(options: {
  base: SnapPoint[]
  measuredPeekPx?: number | null
  measuredIndex?: number
  viewportHeight: number
  insets?: SafeAreaInsets | null
  lift?: number
}): SnapPoint[] {
  const {
    base,
    measuredPeekPx,
    measuredIndex = 0,
    viewportHeight,
    insets,
    lift = 0,
  } = options
  if (!base.length) return base

  const points = base.map((point, i) =>
    i === measuredIndex && measuredPeekPx != null ? `${measuredPeekPx}px` : point,
  )

  const safe = insets
    ? points.map((point, i) => adjustForSafeArea(point, i, insets, viewportHeight))
    : points
  const adjusted = lift > 0
    ? safe.map(point => `${snapPointToPixels(point, viewportHeight) + lift}px`)
    : safe

  // Clamp last: the home-indicator inset is added to the peek, so clamping
  // before it would let the peek land above the next detent anyway.
  return adjusted.map((point, i) =>
    i === measuredIndex
      ? clampPeek(point, adjusted[i + 1], viewportHeight, adjusted[i - 1])
      : point,
  )
}
