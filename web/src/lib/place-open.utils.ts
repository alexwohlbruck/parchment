import type { OpeningHours, OpeningTime } from '@/types/place.types'

const MINUTES_PER_DAY = 1440
const MINUTES_PER_WEEK = MINUTES_PER_DAY * 7

export function getLocalDayAndTime(timezone?: string): { day: number; time: string } {
  const now = new Date()
  if (timezone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    }).formatToParts(now)

    const weekdayStr = parts.find(p => p.type === 'weekday')?.value ?? ''
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    const day = dayMap[weekdayStr] ?? now.getDay()

    const hour = parts.find(p => p.type === 'hour')?.value ?? '00'
    const minute = parts.find(p => p.type === 'minute')?.value ?? '00'
    // `hour` comes back as 24 at midnight under hour12: false.
    const time = `${String(Number(hour) % 24).padStart(2, '0')}:${minute.padStart(2, '0')}`

    return { day, time }
  }

  return {
    day: now.getDay(),
    time: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`,
  }
}

function toMinutes(time: string): number {
  const [h = '0', m = '0'] = time.split(':')
  return Number(h) * 60 + Number(m)
}

/**
 * A span as an absolute position in the week, in minutes.
 *
 * A closing time at or before the opening time means the span runs past
 * midnight — a bar open `22:00-02:00` closes on the following day, and
 * comparing the two clock strings directly would read it as never open.
 */
function toWeekSpan(slot: OpeningTime): { start: number; duration: number } {
  const open = toMinutes(slot.open)
  const close = toMinutes(slot.close)
  const duration = close > open ? close - open : MINUTES_PER_DAY - open + close

  return { start: slot.day * MINUTES_PER_DAY + open, duration }
}

/** Minutes from `from` to `to`, wrapping forward around the week. */
function forwardDistance(from: number, to: number): number {
  return (to - from + MINUTES_PER_WEEK) % MINUTES_PER_WEEK
}

export interface OpeningStatus {
  isOpen: boolean
  /** Where the place is in its week, for the caller to phrase. */
  state:
    | 'open24_7'
    | 'permanentlyClosed'
    | 'temporarilyClosed'
    | 'open'
    | 'opensLater'
    | 'closed'
  /** "HH:mm" the current span ends, when open. */
  closesAt?: string
  /** "HH:mm" the next span begins, when closed and one is known. */
  opensAt?: string
  /** Day index of the next opening, when it isn't today. */
  opensDay?: number
}

/**
 * Resolve a place's standing against its own local clock.
 *
 * Shared so the header, the details row and the hours list can't drift apart —
 * each phrases the result its own way, but they agree on the facts.
 */
export function resolveOpeningStatus(
  hours: OpeningHours | null | undefined,
  timezone?: string,
): OpeningStatus | null {
  if (!hours) return null

  if (hours.isPermanentlyClosed) return { isOpen: false, state: 'permanentlyClosed' }
  if (hours.isTemporarilyClosed) return { isOpen: false, state: 'temporarilyClosed' }
  if (hours.isOpen24_7) return { isOpen: true, state: 'open24_7' }
  if (!hours.regularHours?.length) return null

  const { day, time } = getLocalDayAndTime(timezone)
  const nowMinutes = day * MINUTES_PER_DAY + toMinutes(time)

  const spans = hours.regularHours.map(toWeekSpan)

  // Open when now falls inside a span. Spans are compared as offsets from their
  // own start so one running past midnight, or past Saturday into Sunday, still
  // matches.
  for (const span of spans) {
    if (forwardDistance(span.start, nowMinutes) < span.duration) {
      const closes = (span.start + span.duration) % MINUTES_PER_WEEK
      return {
        isOpen: true,
        state: 'open',
        closesAt: formatWeekMinutes(closes),
      }
    }
  }

  const next = spans.reduce<{ start: number; distance: number } | null>((best, span) => {
    const distance = forwardDistance(nowMinutes, span.start)
    return !best || distance < best.distance ? { start: span.start, distance } : best
  }, null)

  if (!next) return { isOpen: false, state: 'closed' }

  const opensDay = Math.floor(next.start / MINUTES_PER_DAY) % 7
  return {
    isOpen: false,
    state: 'opensLater',
    opensAt: formatWeekMinutes(next.start),
    // Only call it another day when the clock has to pass midnight to get there.
    opensDay: opensDay === day ? undefined : opensDay,
  }
}

function formatWeekMinutes(weekMinutes: number): string {
  const minutes = ((weekMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Check if a place is currently open based on its opening hours.
 * Returns true (open), false (closed), or null (indeterminate / no data).
 * null means filters should pass this place through rather than hiding it.
 *
 * When timezone is provided, compares against the place's local time
 * instead of the browser's local time.
 */
export function isPlaceOpenNow(
  hours: OpeningHours | null | undefined,
  timezone?: string,
): boolean | null {
  const status = resolveOpeningStatus(hours, timezone)
  return status ? status.isOpen : null
}

/**
 * The mapper's own expression, on one line, for a value we can't evaluate.
 *
 * A seasonal rule or a hand-written note ("by appointment") leaves no schedule
 * to compute a status from. Their words are still the best thing to show —
 * better than an empty row, and far better than a made-up "Closed".
 */
export function formatRawHours(hours: OpeningHours | null | undefined): string {
  return (hours?.rawText ?? '')
    .trim()
    .replace(/^"(.*)"$/s, '$1')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .join(' · ')
}

export interface TimezoneDifference {
  /** The place's current wall clock, e.g. "3:24 PM". */
  localTime: string
  /** Short zone name for the place, e.g. "GMT+9". */
  label: string
}

/**
 * The place's clock, when it differs from the device's.
 *
 * Compares the actual offsets rather than the zone names, so neighbours that
 * merely have different IANA identifiers (America/New_York and America/Detroit)
 * don't produce a notice that tells the reader nothing.
 */
export function getTimezoneDifference(
  timezone: string | undefined,
  locale?: string,
): TimezoneDifference | null {
  if (!timezone) return null

  try {
    const now = new Date()
    const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (offsetMinutes(now, timezone) === offsetMinutes(now, deviceZone)) return null

    const localTime = new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(now)

    const label =
      new Intl.DateTimeFormat(locale, { timeZone: timezone, timeZoneName: 'shortOffset' })
        .formatToParts(now)
        .find(p => p.type === 'timeZoneName')?.value ?? timezone

    return { localTime, label }
  } catch {
    // An unrecognised zone is not worth breaking the page over.
    return null
  }
}

/** A zone's offset from UTC, in minutes, at a given instant. */
function offsetMinutes(instant: Date, timeZone: string): number {
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

  const part = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0')
  const asUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour') % 24,
    part('minute'),
    part('second'),
  )

  return Math.round((asUtc - instant.getTime()) / 60000)
}
