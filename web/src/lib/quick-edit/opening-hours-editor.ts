/**
 * Structured editing model for the common subset of the OSM `opening_hours`
 * grammar: day ranges/lists with one or more time intervals, `off` rules,
 * and `24/7`. Values outside the subset (months, public holidays, sunrise,
 * comments…) fail to parse and the editor falls back to raw text — an
 * existing complex value is never silently rewritten.
 */

export const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const
export type Weekday = (typeof WEEKDAYS)[number]

export interface DaySchedule {
  /** Time intervals as "HH:MM-HH:MM"; empty means closed. */
  intervals: string[]
}

export type WeekSchedule = Record<Weekday, DaySchedule>

export function emptyWeek(): WeekSchedule {
  return Object.fromEntries(
    WEEKDAYS.map((d) => [d, { intervals: [] as string[] }]),
  ) as unknown as WeekSchedule
}

const TIME_INTERVAL = /^([01]?\d|2[0-4]):[0-5]\d-([01]?\d|2[0-4]):[0-5]\d$/

function expandDays(spec: string): Weekday[] | null {
  const days: Weekday[] = []
  for (const part of spec.split(',')) {
    const range = part.trim()
    if (range.includes('-')) {
      const [from, to] = range.split('-')
      const fromIdx = WEEKDAYS.indexOf(from as Weekday)
      const toIdx = WEEKDAYS.indexOf(to as Weekday)
      if (fromIdx === -1 || toIdx === -1) return null
      // Wrap-around ranges (Sa-Mo) are valid OSM
      for (let i = fromIdx; ; i = (i + 1) % 7) {
        days.push(WEEKDAYS[i])
        if (i === toIdx) break
      }
    } else {
      const idx = WEEKDAYS.indexOf(range as Weekday)
      if (idx === -1) return null
      days.push(WEEKDAYS[idx])
    }
  }
  return days
}

/** Parse an opening_hours value into a week grid, or null when out of subset. */
export function parseOpeningHours(value: string): WeekSchedule | null {
  const trimmed = value.trim()
  if (!trimmed) return emptyWeek()
  if (trimmed === '24/7') {
    const week = emptyWeek()
    for (const day of WEEKDAYS) week[day].intervals = ['00:00-24:00']
    return week
  }

  const week = emptyWeek()
  for (const rule of trimmed.split(';')) {
    const r = rule.trim()
    if (!r) continue

    const parts = r.split(/\s+/)
    if (parts.length < 2) return null

    const days = expandDays(parts[0])
    if (!days) return null

    const timeSpec = parts.slice(1).join('')
    if (timeSpec === 'off' || timeSpec === 'closed') {
      for (const day of days) week[day].intervals = []
      continue
    }

    const intervals = timeSpec.split(',').map((t) => t.trim())
    if (!intervals.every((t) => TIME_INTERVAL.test(t))) return null

    for (const day of days) week[day].intervals = [...intervals]
  }
  return week
}

function collapseDays(days: Weekday[]): string {
  const sorted = [...days].sort(
    (a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b),
  )
  const groups: string[] = []
  let start = 0
  while (start < sorted.length) {
    let end = start
    while (
      end + 1 < sorted.length &&
      WEEKDAYS.indexOf(sorted[end + 1]) === WEEKDAYS.indexOf(sorted[end]) + 1
    ) {
      end++
    }
    if (end - start >= 2) groups.push(`${sorted[start]}-${sorted[end]}`)
    else groups.push(...sorted.slice(start, end + 1))
    start = end + 1
  }
  return groups.join(',')
}

/** Serialize a week grid back to a canonical opening_hours value. */
export function serializeOpeningHours(week: WeekSchedule): string {
  const open = WEEKDAYS.filter((d) => week[d].intervals.length > 0)
  if (!open.length) return ''
  if (
    open.length === 7 &&
    open.every((d) => week[d].intervals.join(',') === '00:00-24:00')
  ) {
    return '24/7'
  }

  // Group consecutive days sharing an identical schedule
  const bySchedule = new Map<string, Weekday[]>()
  for (const day of open) {
    const key = week[day].intervals.join(',')
    const existing = bySchedule.get(key)
    if (existing) existing.push(day)
    else bySchedule.set(key, [day])
  }

  return [...bySchedule.entries()]
    .sort(
      (a, b) => WEEKDAYS.indexOf(a[1][0]) - WEEKDAYS.indexOf(b[1][0]),
    )
    .map(([schedule, days]) => `${collapseDays(days)} ${schedule}`)
    .join('; ')
}
