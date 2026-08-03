import type dayjs from 'dayjs'
import type { TransitDeparture } from '@/types/place.types'
import { getMinutesUntil } from '@/lib/transit'

/**
 * Grouping a stop's departure board into route → direction → next few runs.
 *
 * Both the place-detail transit section and the full transit page did this,
 * with the same interfaces and the same loop written out twice. They had
 * drifted in one respect: one sorted unknown times explicitly to the end, the
 * other used `?? 9999` as a sentinel, which mis-orders any departure more than
 * about seven days out. The explicit form is what survives here.
 */

export interface DirectionGroup {
  headsign: string
  /** Soonest first; unknown times last. */
  departures: TransitDeparture[]
  hasRealtime: boolean
}

export interface RouteGroup {
  routeKey: string
  route: TransitDeparture['route']
  directions: DirectionGroup[]
  /** Any departure on this route — enough to open its route detail view. */
  representative: TransitDeparture
}

/** Departures more than a minute past are gone; a rider can't act on them. */
const STALE_AFTER_MINUTES = -1

export interface GroupDeparturesOptions {
  /** Label for a departure with no headsign or direction. */
  unknownDirectionLabel: string
  /** Cap per direction. Omit to keep every upcoming run. */
  limit?: number
}

export function groupDepartures(
  departures: TransitDeparture[],
  now: Date | dayjs.Dayjs,
  { unknownDirectionLabel, limit }: GroupDeparturesOptions,
): RouteGroup[] {
  if (!departures.length) return []

  const byRoute = new Map<
    string,
    {
      route: TransitDeparture['route']
      byDirection: Map<string, TransitDeparture[]>
      representative: TransitDeparture
    }
  >()

  for (const departure of departures) {
    const minutes = getMinutesUntil(departure, now)
    if (minutes !== null && minutes < STALE_AFTER_MINUTES) continue

    const routeKey =
      departure.route.shortName || departure.route.longName || departure.route.id
    const headsign =
      departure.headsign || departure.direction || unknownDirectionLabel

    if (!byRoute.has(routeKey)) {
      byRoute.set(routeKey, {
        route: departure.route,
        byDirection: new Map(),
        representative: departure,
      })
    }
    const entry = byRoute.get(routeKey)!
    if (!entry.byDirection.has(headsign)) entry.byDirection.set(headsign, [])
    entry.byDirection.get(headsign)!.push(departure)
  }

  /** Soonest first, with unknown times sorted to the end rather than to zero. */
  const bySoonest = (a: TransitDeparture, b: TransitDeparture) => {
    const ma = getMinutesUntil(a, now)
    const mb = getMinutesUntil(b, now)
    if (ma === null && mb === null) return 0
    if (ma === null) return 1
    if (mb === null) return -1
    return ma - mb
  }

  return [...byRoute].map(([routeKey, entry]) => ({
    routeKey,
    route: entry.route,
    representative: entry.representative,
    directions: [...entry.byDirection].map(([headsign, deps]) => {
      const sorted = [...deps].sort(bySoonest)
      return {
        headsign,
        departures: limit === undefined ? sorted : sorted.slice(0, limit),
        // Computed from every run, not just the visible ones — the indicator
        // means "this direction has live predictions", not "the next three do".
        hasRealtime: sorted.some(d => d.realTime),
      }
    }),
  }))
}
