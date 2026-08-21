/**
 * Unit tests for the portolan selector logic.
 *
 * Three load-bearing pieces: the four class-group toggles must cover
 * portolan's nine classes exactly once (a class in two groups toggles
 * twice, a class in none becomes untogglable), the slider's date
 * construction must land on the Monday-first weekday the acts masks are
 * laid out in, and gtfs_ids parsing must survive colons inside agency
 * stop_ids.
 */

import { describe, test, expect } from 'vitest'
import { PORTOLAN_CLASSES } from '@/types/portolan.types'
import {
  CLASS_GROUP_MEMBERS,
  TRANSIT_CLASS_GROUPS,
  classVisibilityFor,
  dateAtDaySlot,
  minutesOfDay,
  parseGtfsIds,
  portolanDay,
} from './portolan-ui'

describe('class groups', () => {
  test('partition the portolan classes: every class in exactly one group', () => {
    const seen = new Map<string, number>()
    for (const g of TRANSIT_CLASS_GROUPS) {
      for (const cls of CLASS_GROUP_MEMBERS[g]) {
        seen.set(cls, (seen.get(cls) ?? 0) + 1)
      }
    }
    for (const cls of PORTOLAN_CLASSES) expect(seen.get(cls)).toBe(1)
    expect(seen.size).toBe(PORTOLAN_CLASSES.length)
  })

  test('aerial falls to "other" by subtraction', () => {
    expect(CLASS_GROUP_MEMBERS.other).toContain('aerial')
  })

  test('classVisibilityFor expands groups to a full per-class map', () => {
    const vis = classVisibilityFor({ rail: true, bus: false, ferry: true, other: false })
    expect(vis.metro).toBe(true)
    expect(vis.cable).toBe(true)
    expect(vis.bus).toBe(false)
    expect(vis.ferry).toBe(true)
    expect(vis.aerial).toBe(false)
    // full map: every portolan class gets an explicit verdict
    expect(Object.keys(vis).sort()).toEqual([...PORTOLAN_CLASSES].sort())
  })
})

describe('service-time construction', () => {
  // 2026-08-17 is a Monday
  const monday = new Date(2026, 7, 17, 9, 41, 30)

  test('portolanDay is Monday-first', () => {
    expect(portolanDay(monday)).toBe(0)
    expect(portolanDay(new Date(2026, 7, 23))).toBe(6) // Sunday
  })

  test('same-day slot keeps the date and sets the time', () => {
    const d = dateAtDaySlot(0, 14 * 60 + 5, monday)
    expect(d.getDate()).toBe(17)
    expect(d.getHours()).toBe(14)
    expect(d.getMinutes()).toBe(5)
    expect(d.getSeconds()).toBe(0)
  })

  test('an earlier weekday rolls into next week, never backwards', () => {
    const thursday = new Date(2026, 7, 20, 12, 0)
    const d = dateAtDaySlot(1, 30, thursday) // Tuesday
    expect(portolanDay(d)).toBe(1)
    expect(d.getTime()).toBeGreaterThan(thursday.getTime())
    expect(d.getDate()).toBe(25)
  })

  test('round-trips through minutesOfDay and portolanDay', () => {
    for (let day = 0; day < 7; day++) {
      const d = dateAtDaySlot(day, 23 * 60 + 55, monday)
      expect(portolanDay(d)).toBe(day)
      expect(minutesOfDay(d)).toBe(23 * 60 + 55)
    }
  })
})

describe('parseGtfsIds', () => {
  test('splits pairs and keeps the verbatim stop key', () => {
    const pairs = parseGtfsIds('f-dr5r-nyct:127;f-dr5r-nyct:A32')
    expect(pairs).toEqual([
      { feedOnestopId: 'f-dr5r-nyct', stopId: '127', stopKey: 'f-dr5r-nyct:127' },
      { feedOnestopId: 'f-dr5r-nyct', stopId: 'A32', stopKey: 'f-dr5r-nyct:A32' },
    ])
  })

  test('splits on the first colon only — stop_ids may contain colons', () => {
    const [pair] = parseGtfsIds('f-u0-sncf:StopPoint:OCETrain:87686006')
    expect(pair.feedOnestopId).toBe('f-u0-sncf')
    expect(pair.stopId).toBe('StopPoint:OCETrain:87686006')
  })

  test('absent or malformed input degrades to no pairs', () => {
    expect(parseGtfsIds(undefined)).toEqual([])
    expect(parseGtfsIds('')).toEqual([])
    expect(parseGtfsIds(42)).toEqual([])
    expect(parseGtfsIds(':no-feed;no-stop:;plain')).toEqual([])
  })
})
