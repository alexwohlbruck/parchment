/**
 * Shared time and duration formatting.
 *
 * These all existed as private copies inside individual components — five
 * `formatDuration`s, four `formatTimeAgo`s, three `formatTime`s. Most were not
 * actually the same function, which is why they drifted: a trip wants a
 * compact "2h 5m", a saved route wants "2 hr 5 min", and the GPX simulator
 * wants a "3:07" stopwatch. Giving each shape its own name here means the next
 * caller picks one instead of writing a sixth.
 */

/** Minimal translation function — matches the `t` from `useI18n`. */
type TFn = (key: string, named?: Record<string, unknown>) => string

// ── Durations ──────────────────────────────────────────────────────────────

/** `2h 5m` / `5m`. Dense form, for timelines and trip summaries. */
export function formatDurationCompact(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

/** `2 hr 5 min` / `5 min`. Roomier form, for detail views. */
export function formatDurationLong(seconds: number): string {
  const total = Math.round(seconds / 60)
  if (total < 60) return `${total} min`
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`
}

export interface DurationPart {
  value: number
  unit: string
}

/**
 * Value/unit pairs, for callers that style the number differently from its
 * unit rather than rendering one string.
 */
export function formatDurationParts(seconds: number): { parts: DurationPart[] } {
  const total = Math.round(seconds / 60)
  if (total < 60) return { parts: [{ value: total, unit: 'min' }] }
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  const parts: DurationPart[] = [{ value: hours, unit: 'h' }]
  if (minutes > 0) parts.push({ value: minutes, unit: 'm' })
  return { parts }
}

/** `3:07` stopwatch. Guards non-finite input, which playback math can produce. */
export function formatStopwatch(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

// ── Clock times ────────────────────────────────────────────────────────────

/**
 * `9:30 AM` from an OSM-style `"09:30"`. With `omitZeroMinutes`, an exact hour
 * renders as `9 AM` — used where the hour alone reads cleaner.
 */
export function formatClockTime(
  time: string,
  { omitZeroMinutes = false }: { omitZeroMinutes?: boolean } = {},
): string {
  const [hours, minutes] = time.split(':').map(Number)
  const period = hours >= 12 ? 'PM' : 'AM'
  const hour = hours % 12 || 12
  if (omitZeroMinutes && minutes === 0) return `${hour} ${period}`
  return `${hour}:${minutes.toString().padStart(2, '0')} ${period}`
}

// ── Relative time ──────────────────────────────────────────────────────────

/** Which bucket an elapsed time falls into, and how many of that unit. */
export function timeAgoParts(input: Date | string | number): {
  unit: 'now' | 'minute' | 'hour' | 'day'
  value: number
  date: Date
} {
  const date =
    input instanceof Date ? input : new Date(input)
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return { unit: 'now', value: 0, date }
  if (minutes < 60) return { unit: 'minute', value: minutes, date }
  if (hours < 24) return { unit: 'hour', value: hours, date }
  return { unit: 'day', value: days, date }
}

/**
 * `just now` / `5m ago` / `3h ago` / `2d ago`, translated.
 *
 * Past `absoluteAfterDays` the relative form stops being useful, so it falls
 * back to a plain date. Two of the previous copies hardcoded English; routing
 * every caller through `general.timeAgo.*` fixes that.
 */
export function formatTimeAgo(
  input: Date | string | number,
  t: TFn,
  { absoluteAfterDays = 7 }: { absoluteAfterDays?: number } = {},
): string {
  const { unit, value, date } = timeAgoParts(input)

  switch (unit) {
    case 'now':
      return t('general.timeAgo.justNow')
    case 'minute':
      return t('general.timeAgo.minutesAgo', { n: value })
    case 'hour':
      return t('general.timeAgo.hoursAgo', { n: value })
    case 'day':
      return value < absoluteAfterDays
        ? t('general.timeAgo.daysAgo', { n: value })
        : date.toLocaleDateString()
  }
}
