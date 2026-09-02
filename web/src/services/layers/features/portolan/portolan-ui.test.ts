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
  stopTargetFor,
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

describe('which place a clicked station is', () => {
  // the live case: one station, both ids, two candidate URLs
  const CONEY = {
    ftype: 'station',
    name: 'Coney Island-Stillwell Av',
    osm: 'node/1683730419',
    gtfs_ids: 'f-dr5r-nyctsubway:D43',
  }

  test('the OSM object wins, so the transit label and the POI open one page', () => {
    expect(stopTargetFor(CONEY)).toEqual({ kind: 'osm', type: 'node', id: '1683730419' })
  })

  test('ways and relations route as themselves', () => {
    expect(stopTargetFor({ osm: 'way/123' })).toEqual({ kind: 'osm', type: 'way', id: '123' })
    expect(stopTargetFor({ osm: 'relation/9' })).toEqual({ kind: 'osm', type: 'relation', id: '9' })
  })

  test('an unmatched station still opens its feed’s stop', () => {
    const { osm, ...noMatch } = CONEY
    expect(stopTargetFor(noMatch)).toEqual({ kind: 'transitland', stopKey: 'f-dr5r-nyctsubway:D43' })
  })

  test('a complex opens the first pair, which the tiler ranked first', () => {
    const props = { gtfs_ids: 'f-dr5r-nyctsubway:635;f-dr5r-nyctsubway:418' }
    expect(stopTargetFor(props)).toEqual({ kind: 'transitland', stopKey: 'f-dr5r-nyctsubway:635' })
  })

  test('a station with neither is not a link', () => {
    expect(stopTargetFor({ ftype: 'station', name: 'Somewhere' })).toBe(null)
    expect(stopTargetFor(undefined)).toBe(null)
  })

  test('a malformed osm value is not half-parsed into a dead URL', () => {
    for (const osm of ['node', 'node/', '/1683730419', '']) {
      expect(stopTargetFor({ osm })).toBe(null)
    }
  })
})

describe('opening a merged station', () => {
  /**
   * One drawn label can stand for a whole interchange: New York has four
   * separate GTFS stations named "Canal St", and the map merges them. Tapping
   * that label should open all of them, while tapping one corridor's marker
   * opens only the station it sits on — Apple's hybrid.
   */
  test('marks the merged label as a complex', () => {
    expect(
      stopTargetFor({ ftype: 'station', nmarkers: 3, osm: 'node/7613354754' })?.complex,
    ).toBe(true)
  })

  test('leaves a single-bundle station alone', () => {
    expect(
      stopTargetFor({ ftype: 'station', nmarkers: 1, osm: 'node/1' })?.complex,
    ).toBeFalsy()
  })

  test("leaves one corridor's marker alone", () => {
    // A marker carries the station's ids, not its own — so without this it
    // would inherit the complex flag and open the whole interchange.
    expect(
      stopTargetFor({ ftype: 'marker', nmarkers: 3, osm: 'node/1' })?.complex,
    ).toBeFalsy()
  })

  test('does not count gtfs_ids, which lists platforms too', () => {
    // Q01, Q01N and Q01S are one station; counting pairs would call it three.
    expect(
      stopTargetFor({ ftype: 'station', nmarkers: 1, gtfs_ids: 'f:Q01;f:Q01N;f:Q01S' })
        ?.complex,
    ).toBeFalsy()
  })
})
