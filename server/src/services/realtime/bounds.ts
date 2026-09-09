/**
 * Viewport bounds validation for realtime transit subscriptions.
 *
 * Bounds arrive over the WebSocket as untrusted client JSON and are used to
 * build spatial queries, so they are validated before use. Lives here rather
 * than inline in the WS handler so the check has one implementation that both
 * the handler and its tests exercise.
 */

export interface ViewportBounds {
  north: number
  south: number
  east: number
  west: number
}

/**
 * Return the bounds unchanged when they are usable, otherwise null.
 *
 * Requires finite numbers (rejecting NaN and Infinity, which would otherwise
 * flow into a query as unbounded), latitude and longitude within their real
 * ranges, and north at or above south. East/west are NOT compared: a viewport
 * straddling the antimeridian legitimately has west > east.
 */
export function validateBounds(bounds: unknown): ViewportBounds | null {
  const b = bounds as ViewportBounds | null | undefined
  const valid =
    b &&
    Number.isFinite(b.north) &&
    Number.isFinite(b.south) &&
    Number.isFinite(b.east) &&
    Number.isFinite(b.west) &&
    b.north >= b.south &&
    b.north >= -90 &&
    b.north <= 90 &&
    b.south >= -90 &&
    b.south <= 90 &&
    b.east >= -180 &&
    b.east <= 180 &&
    b.west >= -180 &&
    b.west <= 180
  return valid ? b : null
}
