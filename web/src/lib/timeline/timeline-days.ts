import dayjs from 'dayjs'
import { TravelMode } from '@server/types/unified-routing.types'
import type { LocationHistoryEntry } from '@server/types/location-history.types'

export interface TimelineDay {
  /** YYYY-MM-DD */
  key: string
  entries: LocationHistoryEntry[]
  places: number
  distance: number
  moving: number
}

export function summarizeEntries(entries: LocationHistoryEntry[]) {
  let places = 0
  let distance = 0
  let moving = 0
  for (const entry of entries) {
    if (entry.type === 'stop') places++
    else {
      distance += entry.distance
      moving += entry.duration
    }
  }
  return { places, distance, moving }
}

/**
 * Groups entries by local day. An entry that began before the range — the
 * drive home that crossed midnight — belongs to the first day shown rather
 * than to a day the user didn't ask for.
 */
export function groupEntriesByDay(
  entries: LocationHistoryEntry[],
  rangeStart: Date,
): TimelineDay[] {
  const firstKey = dayjs(rangeStart).format('YYYY-MM-DD')
  const groups = new Map<string, LocationHistoryEntry[]>()
  for (const entry of entries) {
    const own = dayjs(entry.startTime).format('YYYY-MM-DD')
    const key = own < firstKey ? firstKey : own
    const list = groups.get(key)
    if (list) list.push(entry)
    else groups.set(key, [entry])
  }
  return Array.from(groups, ([key, dayEntries]) => ({
    key,
    entries: dayEntries,
    ...summarizeEntries(dayEntries),
  }))
}

/** Whole kilometres or miles once a distance reaches double digits. */
export function distancePrecision(meters: number): number {
  return meters >= 10_000 ? 0 : 1
}

/** `Jun 8` / `Jun 1 – 7` / `May 28 – Jun 3`, adding the year only when it isn't this one. */
export function formatRangeLabel(start: Date, end: Date, now = new Date()): string {
  const a = dayjs(start)
  const b = dayjs(end)
  const thisYear = a.isSame(now, 'year') && b.isSame(now, 'year')
  if (a.isSame(b, 'day')) return a.format(thisYear ? 'ddd, MMM D' : 'ddd, MMM D, YYYY')
  const year = thisYear ? '' : `, ${b.format('YYYY')}`
  if (a.isSame(b, 'month')) return `${a.format('MMM D')} – ${b.format('D')}${year}`
  return `${a.format('MMM D')} – ${b.format('MMM D')}${year}`
}

export type SegmentModeKey = 'driving' | 'cycling' | 'transit' | 'walking'

export function segmentModeKey(mode: TravelMode): SegmentModeKey {
  switch (mode) {
    case TravelMode.DRIVING:
    case TravelMode.MOTORCYCLE:
    case TravelMode.TRUCK:
      return 'driving'
    case TravelMode.CYCLING:
      return 'cycling'
    case TravelMode.TRANSIT:
      return 'transit'
    default:
      return 'walking'
  }
}
