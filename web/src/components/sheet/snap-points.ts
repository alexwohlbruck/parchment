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
 * Keep the peek strictly below the next detent. On a short screen a tall
 * header would otherwise overshoot it and break the ascending order.
 */
export function clampPeek(
  point: SnapPoint,
  nextPoint: SnapPoint | undefined,
  viewportHeight: number,
): SnapPoint {
  if (typeof point !== 'string' || !point.endsWith('px')) return point
  if (nextPoint === undefined) return point
  const max = snapPointToPixels(nextPoint, viewportHeight) - PEEK_GAP_PX
  if (max <= 0) return point
  return `${Math.min(parseFloat(point), max)}px`
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
 * The final list handed to Vaul: the measured peek swapped into the first
 * slot when dynamic peek is active, clamped, then safe-area adjusted.
 */
export function resolveSnapPoints(options: {
  base: SnapPoint[]
  measuredPeekPx?: number | null
  viewportHeight: number
  insets?: SafeAreaInsets | null
}): SnapPoint[] {
  const { base, measuredPeekPx, viewportHeight, insets } = options
  if (!base.length) return base

  const peek = measuredPeekPx != null ? `${measuredPeekPx}px` : base[0]
  const points = [peek, ...base.slice(1)]

  const adjusted = insets
    ? points.map((point, i) => adjustForSafeArea(point, i, insets, viewportHeight))
    : points

  // Clamp last: the home-indicator inset is added to the peek, so clamping
  // before it would let the peek land above the next detent anyway.
  return [clampPeek(adjusted[0], adjusted[1], viewportHeight), ...adjusted.slice(1)]
}
