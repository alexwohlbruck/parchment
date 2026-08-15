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

/**
 * A run as the board renders it: the departure plus, on the first run of each
 * new local day, the label that separates it from the day before.
 */
export type BoardDeparture = TransitDeparture & {
  /** "Tonight", "Tomorrow", "Sat" — set only where the day changes. */
  dayLabel?: string
}

export interface DirectionGroup {
  headsign: string
  /** Soonest first; unknown times last. */
  departures: BoardDeparture[]
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

/**
 * Calendar date of an instant in the stop's own timezone, as YYYY-MM-DD.
 *
 * The stop's zone, not the browser's: looking up a Vancouver ferry from London
 * should say "Tomorrow" when it is tomorrow at the dock. `en-CA` is what gives
 * `Intl` an ISO-ordered date without hand-assembling the parts.
 */
function localDate(at: Date, timezone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at)
  } catch {
    // An unknown zone from a feed shouldn't take the board down with it.
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(at)
  }
}

/** Days between two YYYY-MM-DD dates, ignoring any time component. */
function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

export interface DayLabelOptions {
  /** "Tonight" — a run past midnight that still belongs to today's timetable. */
  tonight: string
  tomorrow: string
}

/**
 * How a run departing on a later date than today should be introduced.
 *
 * Two calendar days is not the same as two service days. GTFS files an 01:00
 * train under the *previous* day's service, published as a 25:00 stop time, so
 * at a station running all night two departures three minutes apart can belong
 * to different service days. Grouping strictly by service date would show a
 * rider those two runs under different headings; grouping strictly by calendar
 * date would call tonight's last tram "tomorrow". So the day boundary is the
 * calendar — what a rider reads off a clock — and the service date only picks
 * the wording: a late run still on today's timetable reads "Tonight".
 *
 * Returns null for a run departing today, which needs no introduction.
 */
export function resolveDayLabel(
  departure: TransitDeparture,
  now: Date | dayjs.Dayjs,
  { tonight, tomorrow }: DayLabelOptions,
): string | null {
  const absolute = departure.departureAt || departure.departureTime
  if (!absolute) return null

  const at = new Date(absolute)
  if (isNaN(at.getTime())) return null

  const timezone = departure.timezone
  const nowDate = localDate(
    now instanceof Date ? now : (now as dayjs.Dayjs).toDate(),
    timezone,
  )
  const departureDate = localDate(at, timezone)
  if (departureDate === nowDate) return null

  const days = daysBetween(nowDate, departureDate)
  if (days === 1) {
    // Still filed under today's service — "Tonight", not "Tomorrow".
    return departure.serviceDate === nowDate ? tonight : tomorrow
  }
  if (days > 1 && days < 7) {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone || undefined, weekday: 'short',
    }).format(at)
  }

  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone || undefined, month: 'short', day: 'numeric',
  }).format(at)
}

export interface GroupDeparturesOptions {
  /** Label for a departure with no headsign or direction. */
  unknownDirectionLabel: string
  /** Cap per direction. Omit to keep every upcoming run. */
  limit?: number
  /** Supply to mark where the board crosses into a new day. */
  dayLabels?: DayLabelOptions
}

/**
 * Tag the first run of each new day, leaving the rest untouched. Runs are
 * shallow-copied so the annotation never leaks back into the widget's data.
 */
function withDayLabels(
  departures: TransitDeparture[],
  now: Date | dayjs.Dayjs,
  options?: DayLabelOptions,
): BoardDeparture[] {
  if (!options) return departures

  let previousLabel: string | null = null
  return departures.map((departure) => {
    const label = resolveDayLabel(departure, now, options)
    const isNewDay = label !== null && label !== previousLabel
    previousLabel = label
    return isNewDay ? { ...departure, dayLabel: label! } : departure
  })
}

export function groupDepartures(
  departures: TransitDeparture[],
  now: Date | dayjs.Dayjs,
  { unknownDirectionLabel, limit, dayLabels }: GroupDeparturesOptions,
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
      const visible = limit === undefined ? sorted : sorted.slice(0, limit)
      return {
        headsign,
        departures: withDayLabels(visible, now, dayLabels),
        // Computed from every run, not just the visible ones — the indicator
        // means "this direction has live predictions", not "the next three do".
        hasRealtime: sorted.some(d => d.realTime),
      }
    }),
  }))
}
