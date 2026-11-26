export const MAX_STAY_NIGHTS = 30
export const MAX_STAY_ADULTS = 8

const DAY_MS = 24 * 60 * 60 * 1000

function parseDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value ? null : time
}

/** Whether a stay can be priced: real dates, check-in no earlier than yesterday in UTC, 1–30 nights. */
export function isValidStay(checkin: string, checkout: string, now = new Date()): boolean {
  const start = parseDay(checkin)
  const end = parseDay(checkout)
  if (start === null || end === null) return false
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const nights = (end - start) / DAY_MS
  return start >= today - DAY_MS && nights >= 1 && nights <= MAX_STAY_NIGHTS
}
