import { describe, it, expect } from 'vitest'
import type {
  LocationHistoryStop,
  LocationHistorySegment,
} from '@server/types/location-history.types'
import { TravelMode } from '@server/types/unified-routing.types'
import { formatRangeLabel, groupEntriesByDay } from './timeline-days'

const stop = (id: string, startTime: string): LocationHistoryStop => ({
  type: 'stop',
  id,
  name: null,
  address: null,
  coordinate: { lat: 0, lng: 0 },
  startTime,
  endTime: startTime,
  duration: 600,
})

const drive = (id: string, startTime: string, distance = 1000): LocationHistorySegment => ({
  type: 'segment',
  id,
  mode: TravelMode.DRIVING,
  startTime,
  endTime: startTime,
  duration: 3600,
  distance,
  geometry: [],
})

describe('groupEntriesByDay', () => {
  it('folds an entry that began before the range into the first day', () => {
    const days = groupEntriesByDay(
      [drive('a', '2026-06-07T23:39:00'), stop('b', '2026-06-08T00:40:00')],
      new Date('2026-06-08T00:00:00'),
    )
    expect(days).toHaveLength(1)
    expect(days[0]).toMatchObject({ key: '2026-06-08', places: 1 })
    expect(days[0].entries.map(e => e.id)).toEqual(['a', 'b'])
  })

  it('splits a multi-day range and totals each day', () => {
    const days = groupEntriesByDay(
      [
        stop('a', '2026-06-08T09:00:00'),
        drive('b', '2026-06-08T10:00:00', 1200),
        drive('c', '2026-06-09T10:00:00', 500),
      ],
      new Date('2026-06-08T00:00:00'),
    )
    expect(days.map(d => [d.key, d.places, d.distance])).toEqual([
      ['2026-06-08', 1, 1200],
      ['2026-06-09', 0, 500],
    ])
  })
})

describe('formatRangeLabel', () => {
  const now = new Date('2026-11-24T12:00:00')
  const d = (s: string) => new Date(`${s}T12:00:00`)

  it('names a single day', () => {
    expect(formatRangeLabel(d('2026-06-08'), d('2026-06-08'), now)).toBe('Mon, Jun 8')
  })

  it('shares the month within one month', () => {
    expect(formatRangeLabel(d('2026-06-01'), d('2026-06-07'), now)).toBe('Jun 1 – 7')
  })

  it('names both months across a boundary', () => {
    expect(formatRangeLabel(d('2026-05-28'), d('2026-06-03'), now)).toBe('May 28 – Jun 3')
  })

  it('adds the year outside the current one', () => {
    expect(formatRangeLabel(d('2025-06-08'), d('2025-06-08'), now)).toBe('Sun, Jun 8, 2025')
  })
})
