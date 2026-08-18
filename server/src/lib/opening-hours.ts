/**
 * OSM `opening_hours` parsing, backed by the reference implementation.
 *
 * The syntax is a small language, not a format — weekday lists and ranges that
 * wrap the week, several spans a day, overnight and past-midnight hours
 * (`22:00-28:00`), open-ended times, month and year selectors, nth-weekday
 * constraints, public holidays, solar times, comments and three different rule
 * separators. Hand-rolled regexes silently mangle most of it, so parsing is
 * delegated to `opening_hours.js` and this module's job is the two things that
 * library can't do for us: evaluate in the *place's* timezone, and flatten the
 * result into the weekly schedule our `OpeningHours` type carries.
 *
 * https://wiki.openstreetmap.org/wiki/Key:opening_hours/specification
 */

import oh from 'opening_hours'
import { getTimes } from 'suncalc'
import type { OpeningHours, OpeningTime } from '../types/place.types'

const MINUTES_PER_DAY = 1440
const DAYS_PER_WEEK = 7

/** Solar events the spec allows in place of a clock time. */
const SOLAR_EVENTS = ['sunrise', 'sunset', 'dawn', 'dusk'] as const
type SolarEvent = (typeof SOLAR_EVENTS)[number]

/** Matches `sunrise`, and the offset form `(sunset-00:30)`. */
const SOLAR_PATTERN = new RegExp(
  `\\(\\s*(${SOLAR_EVENTS.join('|')})\\s*([+-])\\s*(\\d{1,2}):(\\d{2})\\s*\\)|\\b(${SOLAR_EVENTS.join('|')})\\b`,
  'gi',
)

export interface OpeningHoursContext {
  /** IANA timezone of the place. Hours are evaluated against this clock. */
  timezone?: string
  /** Coordinates, needed to resolve `sunrise`/`sunset`/`dawn`/`dusk`. */
  lat?: number
  lng?: number
  /** ISO 3166-1 alpha-2 country code, selects the `PH` holiday calendar. */
  countryCode?: string
  /** Sub-division name, refines the `PH` calendar in federal countries. */
  region?: string
}

/**
 * A `Date` whose *local* getters read as the wall clock in `timeZone`.
 *
 * `opening_hours.js` evaluates everything through local `Date` getters, so a
 * value like `Mo 09:00` means 09:00 in whatever zone the process runs in — UTC
 * in our containers. Feeding it wall-clock dates is what makes "9am" mean 9am
 * where the place actually is. Reading the results back with the same local
 * getters closes the loop, so the frame never has to be undone.
 */
function toWallClock(instant: Date, timeZone?: string): Date {
  if (!timeZone) return new Date(instant)

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(instant)

    const part = (type: string) =>
      Number(parts.find(p => p.type === type)?.value ?? '0')

    // `hour` comes back as 24 at midnight under hour12: false.
    return new Date(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour') % 24,
      part('minute'),
      part('second'),
    )
  } catch {
    // An unknown timezone shouldn't cost us the hours entirely.
    return new Date(instant)
  }
}

/** The place's IANA zone from its coordinates, or undefined if unresolvable. */
function resolveTimezone(lat: number, lng: number): string | undefined {
  try {
    // Loaded lazily: geo-tz carries a sizeable dataset and only solar values
    // ever reach this path.
    const { getTimezone } = require('./timezone') as typeof import('./timezone')
    return getTimezone(lat, lng) ?? undefined
  } catch {
    return undefined
  }
}

/** Minutes since midnight, as "HH:mm". 1440 renders as "24:00", not "00:00". */
function formatMinutes(minutes: number): string {
  const capped = minutes === MINUTES_PER_DAY ? MINUTES_PER_DAY : minutes % MINUTES_PER_DAY
  const h = Math.floor(capped / 60)
  const m = capped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function minutesInto(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/**
 * Replace solar events with the concrete local times they mean on `date`.
 *
 * The library computes these through suncalc but then reads the result with
 * local getters, so on a UTC server `sunrise-sunset` in New York evaluates to
 * 10:08-23:50 instead of 06:08-19:50. Resolving them ourselves against the
 * place's own clock, before the value is ever parsed, sidesteps that entirely.
 */
function resolveSolarEvents(
  value: string,
  date: Date,
  lat: number,
  lng: number,
  timezone?: string,
): string {
  const times = getTimes(date, lat, lng)

  const localMinutes = (event: SolarEvent): number | null => {
    const instant = times[event] as Date | null | undefined
    // Above the polar circles the sun may never cross the horizon, leaving
    // these null — fall through to the library's defaults rather than
    // inventing a sunrise.
    if (!instant || Number.isNaN(instant.getTime())) return null
    return minutesInto(toWallClock(instant, timezone))
  }

  return value.replace(
    SOLAR_PATTERN,
    (match, offsetEvent, sign, hours, mins, bareEvent) => {
      const event = ((offsetEvent || bareEvent) as string).toLowerCase() as SolarEvent
      const base = localMinutes(event)
      if (base === null) return match

      const offset = offsetEvent
        ? (Number(hours) * 60 + Number(mins)) * (sign === '-' ? -1 : 1)
        : 0

      const resolved = base + offset
      if (resolved < 0 || resolved > MINUTES_PER_DAY) return match
      return formatMinutes(resolved)
    },
  )
}

/**
 * Flatten one open interval into weekly entries.
 *
 * A span shorter than a day stays whole so an overnight bar reads as
 * "22:00-02:00" rather than being cut in half at midnight; anything longer is
 * split per day, since a single entry can't express "Friday evening through
 * Monday morning".
 */
function intervalToOpeningTimes(start: Date, end: Date): OpeningTime[] {
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000)
  if (durationMinutes <= 0) return []

  if (durationMinutes <= MINUTES_PER_DAY) {
    const open = minutesInto(start)
    return [
      {
        day: start.getDay(),
        open: formatMinutes(open),
        close: formatMinutes(open + durationMinutes),
      },
    ]
  }

  const times: OpeningTime[] = []
  let cursor = new Date(start)

  while (cursor < end) {
    const dayEnd = new Date(startOfDay(cursor).getTime() + MINUTES_PER_DAY * 60000)
    const segmentEnd = dayEnd < end ? dayEnd : end
    const open = minutesInto(cursor)
    const closeMinutes =
      open + Math.round((segmentEnd.getTime() - cursor.getTime()) / 60000)

    times.push({
      day: cursor.getDay(),
      open: formatMinutes(open),
      close: formatMinutes(closeMinutes),
    })

    cursor = segmentEnd
  }

  return times
}

/** Drop duplicate spans, then order by day and opening time. */
function normalize(times: OpeningTime[]): OpeningTime[] {
  const seen = new Set<string>()
  const unique: OpeningTime[] = []

  for (const time of times) {
    const key = `${time.day}|${time.open}|${time.close}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(time)
  }

  return unique.sort((a, b) => a.day - b.day || a.open.localeCompare(b.open))
}

/**
 * Parse an OSM `opening_hours` value into a weekly schedule.
 *
 * The schedule is projected from today forward a week, so a value restricted to
 * part of the year (`Apr-Sep Mo-Fr 09:00-18:00`) reports the hours actually in
 * force right now rather than the ones it keeps in another season.
 *
 * Returns `null` only when there is nothing to parse. An unparseable value
 * still yields a result carrying `rawText`, so a page can show the mapper's
 * original string instead of falling silent.
 */
export function parseOpeningHours(
  rawText: string | null | undefined,
  context: OpeningHoursContext = {},
): OpeningHours | null {
  const value = rawText?.trim()
  if (!value) return null

  const empty: OpeningHours = {
    regularHours: [],
    isOpen24_7: false,
    isPermanentlyClosed: false,
    isTemporarilyClosed: false,
    rawText: value,
  }

  const { timezone, lat, lng, countryCode, region } = context
  const hasCoordinates = typeof lat === 'number' && typeof lng === 'number'

  // The library reads lat/lon only when they are *strings* — its own typings say
  // `number`, and passing one silently falls back to a stand-in location.
  const nominatim = {
    ...(hasCoordinates ? { lat: String(lat), lon: String(lng) } : {}),
    address: {
      country_code: (countryCode || '').toLowerCase(),
      state: region || '',
    },
  }

  const usesSolarEvents = hasCoordinates && SOLAR_PATTERN.test(value)
  SOLAR_PATTERN.lastIndex = 0

  // Solar times are the one case where the place's own clock changes the
  // answer, and hours are parsed before the timezone is resolved centrally.
  // Deriving it from the coordinates here keeps the cost on the rare values
  // that actually need it.
  const zone =
    timezone ?? (usesSolarEvents ? resolveTimezone(lat!, lng!) : undefined)

  const now = toWallClock(new Date(), zone)
  const weekStart = startOfDay(now)

  const collected: OpeningTime[] = []
  let coveredMinutes = 0

  // Solar times move day to day, so a value that uses them is evaluated one day
  // at a time against that day's sunrise. Everything else parses once.
  const windows = usesSolarEvents ? DAYS_PER_WEEK : 1
  const windowDays = usesSolarEvents ? 1 : DAYS_PER_WEEK

  const dayMs = MINUTES_PER_DAY * 60000

  for (let i = 0; i < windows; i++) {
    const from = new Date(weekStart.getTime() + i * dayMs)
    const to = new Date(from.getTime() + windowDays * dayMs)

    const dayValue = usesSolarEvents
      ? resolveSolarEvents(value, from, lat!, lng!, zone)
      : value

    // Query a day either side of what we report. An overnight span that starts
    // on the last evening of the window would otherwise come back sliced off at
    // midnight, and the tail of the span *before* the window would show up as a
    // phantom early-morning opening.
    let intervals: [Date, Date, boolean, string | undefined][]
    try {
      intervals = new oh(dayValue, nominatim as never).getOpenIntervals(
        new Date(from.getTime() - dayMs),
        new Date(to.getTime() + dayMs),
      )
    } catch {
      // Invalid syntax is common in the wild; the raw string is still useful.
      return empty
    }

    const known = intervals.filter(([, , unknown]) => !unknown)
    // An open-ended value like `08:00+` produces nothing but guessed intervals,
    // and showing "opens at 08:00" beats showing nothing. A `||` fallback rule
    // also reads as unknown, but there the confirmed hours are the real answer
    // and the fallback would otherwise blanket the whole week.
    const usable = known.length > 0 ? known : intervals

    for (const [start, end] of usable) {
      // Coverage is measured only over the reported window, so the padding
      // can't inflate a busy schedule into round-the-clock.
      const overlapStart = Math.max(start.getTime(), from.getTime())
      const overlapEnd = Math.min(end.getTime(), to.getTime())
      if (overlapEnd > overlapStart) {
        coveredMinutes += Math.round((overlapEnd - overlapStart) / 60000)
      }

      // A span belongs to the day it opens on; the padding days are only there
      // to let it finish.
      if (start >= from && start < to) {
        collected.push(...intervalToOpeningTimes(start, end))
      }
    }
  }

  // Round-the-clock: covering the full window leaves nothing to list.
  if (coveredMinutes >= DAYS_PER_WEEK * MINUTES_PER_DAY) {
    return { ...empty, isOpen24_7: true }
  }

  return { ...empty, regularHours: normalize(collected) }
}

/**
 * Whether a place is open at `instant`, per the raw value.
 *
 * Answers straight from the parsed value rather than the flattened weekly
 * schedule, so holiday and seasonal rules the schedule can't express are still
 * honoured — `Nov Th[4] off` shuts on Thanksgiving here, which no seven-entry
 * week can represent.
 *
 * No production path calls this, and that is deliberate rather than an
 * oversight. The open/closed state a reader sees has to keep ticking after the
 * response is sent, so it is derived on the client from `regularHours`. This is
 * how that derivation gets checked: it is the spec-exact answer a flattened
 * week can be measured against, and comparing the two across every real
 * expression in a city is what turned up the overnight and prose-hours defects.
 * The obvious production caller is a server-side "open now" search filter —
 * today that filter can only ask whether a place has any hours at all.
 */
export function isOpenAt(
  rawText: string | null | undefined,
  context: OpeningHoursContext = {},
  instant: Date = new Date(),
): boolean | null {
  const value = rawText?.trim()
  if (!value) return null

  const { timezone, lat, lng, countryCode, region } = context
  const hasCoordinates = typeof lat === 'number' && typeof lng === 'number'
  const local = toWallClock(instant, timezone)

  const resolved = hasCoordinates
    ? resolveSolarEvents(value, local, lat, lng, timezone)
    : value

  try {
    const parsed = new oh(resolved, {
      ...(hasCoordinates ? { lat: String(lat), lon: String(lng) } : {}),
      address: {
        country_code: (countryCode || '').toLowerCase(),
        state: region || '',
      },
    } as never)
    return parsed.getState(local)
  } catch {
    return null
  }
}
