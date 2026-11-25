/** Minutes since local midnight — the time slider's unit. */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

/** Monday-first day index (JS Sunday=0 → Monday=0), matching portolan's acts masks. */
export function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7
}

/**
 * The instant a detached time control stands for: the next occurrence of
 * `day` (Monday-first) at `minutes` past midnight, counted from `from`.
 */
export function dateAtDaySlot(day: number, minutes: number, from = new Date()): Date {
  const d = new Date(from)
  const delta = (day - weekdayIndex(from) + 7) % 7
  d.setDate(d.getDate() + delta)
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return d
}
