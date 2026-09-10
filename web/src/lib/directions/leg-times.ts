import type { TripOption } from '@/types/directions.types'

/**
 * When a trip reaches each stop, keyed by that stop's waypoint index.
 *
 * A multi-stop trip is planned as a chain: each leg sets off when the one
 * before it lands. That hand-off is a real time the rider is committed to,
 * so the stop it happens at can show it rather than leaving them to work it
 * out from the timeline. Only intermediate stops appear — the origin has no
 * arrival and the destination has no leg after it to hand off to.
 */
export function legHandoffTimes(trip: TripOption | undefined): Map<number, Date> {
  const handoffs = new Map<number, Date>()
  if (!trip) return handoffs

  for (const segment of trip.segments) {
    const leg = (segment as { legIndex?: number }).legIndex ?? 0
    // The last segment of leg N ends at waypoint N+1.
    handoffs.set(leg + 1, new Date(segment.endTime))
  }

  // The final leg ends at the destination, which nothing departs from.
  const last = trip.segments[trip.segments.length - 1]
  if (last) handoffs.delete(((last as { legIndex?: number }).legIndex ?? 0) + 1)

  return handoffs
}
