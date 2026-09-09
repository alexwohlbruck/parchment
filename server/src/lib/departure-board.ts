import type { TransitDeparture } from '../types/place.types'

/**
 * How much of the timetable a place's departure board covers.
 *
 * The board used to be sized by MOTIS's `n`, a plain count of events with no
 * time bound. What that buys swings wildly with how often the service runs —
 * 50 events is about 45 minutes at a subway platform and five hours at a ferry
 * landing — and because the board merges several nearby stops, one infrequent
 * neighbour could contribute a run weeks out alongside trains due in minutes.
 *
 * Sizing by time instead makes the board mean the same thing everywhere. The
 * event count is derived from the window, generously enough to fill it at a
 * busy stop, and capped so a 24-hour view of a three-minute headway doesn't
 * turn into a megabyte of JSON.
 */

/** Opening view: enough to plan the next trip without a wall of times. */
export const DEFAULT_WINDOW_MINUTES = 180

/** What "show more" asks for — the rest of the day and into tomorrow. */
export const EXPANDED_WINDOW_MINUTES = 1440

const MIN_EVENTS = 150
const MAX_EVENTS = 750

/** Runs kept per route + direction, so one frequent line can't crowd the board. */
const DEFAULT_MAX_PER_DIRECTION = 10
const EXPANDED_MAX_PER_DIRECTION = 30

export interface BoardWindow {
  windowMinutes: number
  /** MOTIS `n` — asked for per stop, then trimmed to the window. */
  events: number
  maxPerDirection: number
}

export function resolveBoardWindow(requested?: number): BoardWindow {
  const windowMinutes =
    requested && Number.isFinite(requested) && requested > 0
      ? Math.min(requested, EXPANDED_WINDOW_MINUTES)
      : DEFAULT_WINDOW_MINUTES

  return {
    windowMinutes,
    // 1.5 events a minute covers the tightest headway we see; the floor keeps
    // sparse stops from being cut short by a small window.
    events: Math.min(MAX_EVENTS, Math.max(MIN_EVENTS, Math.round(windowMinutes * 1.5))),
    maxPerDirection:
      windowMinutes > DEFAULT_WINDOW_MINUTES
        ? EXPANDED_MAX_PER_DIRECTION
        : DEFAULT_MAX_PER_DIRECTION,
  }
}

/** What the board groups by — the same split the UI renders as a row. */
function directionKey(departure: TransitDeparture): string {
  const route = departure.route.id || departure.route.shortName || ''
  const direction =
    departure.trip?.directionId ?? departure.headsign ?? departure.direction ?? ''
  return `${route}::${direction}`
}

function departureAt(departure: TransitDeparture): number {
  const raw = departure.departureAt || departure.departureTime || ''
  const at = Date.parse(raw)
  return isNaN(at) ? Infinity : at
}

/**
 * Merge every nearby stop's departures into one board: soonest first, with each
 * route + direction capped so a frequent line can't push a once-an-hour one off
 * the end. `hasMore` is true when any stop had runs past what it returned.
 */
export function shapeBoard(
  stops: Array<{ departures: TransitDeparture[]; hasMore?: boolean }>,
  { maxPerDirection }: Pick<BoardWindow, 'maxPerDirection'>,
): { departures: TransitDeparture[]; hasMore: boolean } {
  const all = stops.flatMap((s) => s.departures).sort((a, b) => departureAt(a) - departureAt(b))

  const kept: TransitDeparture[] = []
  const perDirection = new Map<string, number>()
  let capped = false

  for (const departure of all) {
    const key = directionKey(departure)
    const count = perDirection.get(key) || 0
    if (count >= maxPerDirection) {
      capped = true
      continue
    }
    perDirection.set(key, count + 1)
    kept.push(departure)
  }

  return {
    departures: kept,
    hasMore: capped || stops.some((s) => s.hasMore),
  }
}
