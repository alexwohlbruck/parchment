/**
 * Which of a leg's interchangeable routes actually run it at the time ridden.
 *
 * The interchangeable set comes from GTFS trip patterns, which hold every
 * pattern a route ever runs: the N and D stop at Union St late at night, so a
 * daytime R leg from Atlantic Av listed D/N/R/W. A route belongs on the leg
 * only when both its stops' departure boards show it around the ride.
 */

export interface StopBoard {
  departures?: Array<{
    tripId?: string
    route?: { shortName?: string }
    directionId?: string | number | null
    departureTime?: string
    realTime?: boolean
    cancelled?: boolean
  }>
}

/** Minutes either side of the boarding and alighting times a run may fall. */
export const ROUTE_SERVICE_SLACK_MINUTES = 20

/** Events requested per board; a board this full may have been cut short. */
export const ROUTE_SERVICE_BOARD_EVENTS = 150

/** Up to when a board is complete: one holding `cap` events may have been cut short after its last run. */
export function boardCompleteUntil(board: StopBoard, untilMs: number, cap = ROUTE_SERVICE_BOARD_EVENTS): number {
  const departures = board.departures ?? []
  if (departures.length < cap) return untilMs
  const times = departures.map((d) => Date.parse(d.departureTime ?? '')).filter((t) => !Number.isNaN(t))
  return Math.min(untilMs, Math.max(...times))
}

/**
 * Route short names departing a stop within `[fromMs, toMs]`, in the leg's
 * direction when it has one. Null when the boards prove nothing: none came
 * back, one was cut off by the event cap before `toMs`, or the leg's own route
 * is missing, which means the board does not describe this ride (a terminal, a stale bake).
 */
export function routesServingStop(
  boards: StopBoard[] | null,
  window: { fromMs: number; toMs: number },
  ownRoute: string,
  directionId?: string | number | null,
): Set<string> | null {
  if (!boards?.length) return null
  const seen = new Set<string>()
  for (const board of boards) {
    const departures = board.departures ?? []
    if (boardCompleteUntil(board, window.toMs) < window.toMs) return null
    for (const d of departures) {
      const name = d.route?.shortName
      if (!name || d.cancelled) continue
      if (directionId != null && d.directionId != null && String(d.directionId) !== String(directionId)) continue
      const at = Date.parse(d.departureTime ?? '')
      if (Number.isNaN(at) || at < window.fromMs || at > window.toMs) continue
      seen.add(name)
    }
  }
  return seen.has(ownRoute) ? seen : null
}

/**
 * The options that run at both ends of the leg. The leg's own route always
 * stays; a stop without evidence constrains nothing.
 */
export function servedRouteOptions<T extends { shortName?: string }>(
  options: T[],
  ownRoute: string,
  servingStops: Array<Set<string> | null>,
): T[] {
  return options.filter((o) => {
    if (!o.shortName) return false
    if (o.shortName === ownRoute) return true
    return servingStops.every((s) => s == null || s.has(o.shortName!))
  })
}
