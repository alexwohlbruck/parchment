// geo-tz ships CJS-only; bun's bundler can't resolve named exports from CJS,
// so we use require() to avoid the "undefined import" warning at build time.
let find: typeof import('geo-tz').find | undefined

export function getTimezone(lat: number, lng: number): string | null {
  // Resolved on first use: geo-tz carries a sizeable dataset, and importing
  // this module shouldn't cost a server that never asks for a timezone.
  find ??= (require('geo-tz') as typeof import('geo-tz')).find
  return find(lat, lng)[0] ?? null
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

/**
 * The instant a wall-clock time in `timeZone` names. `wallMs` is that wall
 * time read as if it were UTC, e.g. `Date.UTC(2026, 10, 20, 18, 0)`.
 */
export function wallClockToUtc(wallMs: number, timeZone?: string | null): Date {
  if (!timeZone) return new Date(wallMs)
  try {
    const parts = zoneFormatter(timeZone).formatToParts(new Date(wallMs))
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
    const zonedMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
    return new Date(wallMs - (zonedMs - wallMs))
  } catch {
    return new Date(wallMs)
  }
}
