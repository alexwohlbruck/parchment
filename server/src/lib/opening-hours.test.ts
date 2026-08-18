/**
 * OSM `opening_hours` parsing.
 *
 * The hand-rolled parsers this replaced got the *time* wrong in ways that read
 * as plausible on the page, which is the worst kind of wrong: an unpadded
 * "9:00" that string-compares below "09:30", an afternoon shift silently
 * dropped after the comma, weekday ranges that wrap the week returning nothing.
 * The cases below are the syntax from the wiki specification, and each one is
 * here because getting it wrong tells somebody a place is open when it is shut.
 *
 * Results are projected from *today*, so assertions look for the shape of a
 * week rather than pinning a date — except where a value is deliberately
 * date-dependent, which is checked by property instead.
 *
 * https://wiki.openstreetmap.org/wiki/Key:opening_hours/specification
 */

import { describe, test, expect } from 'bun:test'
import { parseOpeningHours } from './opening-hours'

/** Somewhere with a clock far from the server's UTC, to catch frame errors. */
const NYC = {
  timezone: 'America/New_York',
  lat: 40.7175,
  lng: -73.9412,
  countryCode: 'us',
  region: 'New York',
}

const MON = 1
const SAT = 6
const SUN = 0

/** Every span the value produces for one weekday, as "open-close". */
const onDay = (value: string | null | undefined, day: number, context = NYC) =>
  (parseOpeningHours(value, context)?.regularHours ?? [])
    .filter(h => h.day === day)
    .map(h => `${h.open}-${h.close}`)

const daysCovered = (value: string, context = NYC) =>
  new Set((parseOpeningHours(value, context)?.regularHours ?? []).map(h => h.day))

describe('weekday selectors', () => {
  test('a weekday range covers exactly its days', () => {
    expect([...daysCovered('Mo-Fr 09:00-17:00')].sort()).toEqual([1, 2, 3, 4, 5])
  })

  test('a range that wraps the week keeps both ends', () => {
    // Sa(6) to Su(0) runs off the end of the week; a naive index loop drops it.
    expect([...daysCovered('Sa-Su 10:00-16:00')].sort()).toEqual([0, 6])
  })

  test('a range wrapping across the weekend covers all four days', () => {
    expect([...daysCovered('Fr-Mo 10:00-16:00')].sort()).toEqual([0, 1, 5, 6])
  })

  test('a comma-separated day list keeps every day', () => {
    expect([...daysCovered('Mo,We,Fr 09:00-17:00')].sort()).toEqual([1, 3, 5])
  })

  test('omitting the weekday means every day', () => {
    expect(daysCovered('09:00-17:00').size).toBe(7)
  })
})

describe('time spans', () => {
  test('a second span after the comma survives', () => {
    // The whole afternoon used to vanish here.
    expect(onDay('Mo-Fr 08:00-12:00, 13:00-18:00', MON)).toEqual([
      '08:00-12:00',
      '13:00-18:00',
    ])
  })

  test('a single-digit hour is zero-padded', () => {
    // "9:00" sorts *above* "09:30" as a string, so an unpadded hour reported a
    // place closed for its entire morning.
    expect(onDay('Mo-Fr 9:00-17:00', MON)).toEqual(['09:00-17:00'])
  })

  test('extra whitespace does not defeat the parse', () => {
    expect(onDay('Mo-Fr  09:00-17:00', MON)).toEqual(['09:00-17:00'])
  })

  test('an overnight span stays attached to the day it opens', () => {
    expect(onDay('Tu-Sa 22:00-02:00', SAT)).toEqual(['22:00-02:00'])
  })

  test('an overnight span does not leak onto the following morning', () => {
    // The Saturday-night span belongs to Saturday; a phantom Sunday opening
    // would make the place look open on a morning it is shut.
    expect(onDay('Tu-Sa 22:00-02:00', SUN)).toEqual([])
  })

  test('past-midnight hours are normalised to a real clock time', () => {
    // 28:00 is 04:00 the next day, not an hour that exists.
    expect(onDay('Mo-Fr 22:00-28:00', MON)).toEqual(['22:00-04:00'])
  })

  test('midnight close renders as the end of the day', () => {
    expect(onDay('Mo 00:00-24:00', MON)).toEqual(['00:00-24:00'])
  })

  test('an open-ended time is reported rather than dropped', () => {
    expect(onDay('Mo-Fr 08:00+', MON)).toEqual(['08:00-24:00'])
  })
})

describe('round the clock', () => {
  test.each(['24/7', 'Mo-Su 00:00-24:00', '00:00-24:00'])('%s is 24/7', value => {
    const parsed = parseOpeningHours(value, NYC)

    expect(parsed?.isOpen24_7).toBe(true)
    // Nothing to list when the answer is "always".
    expect(parsed?.regularHours).toEqual([])
  })

  test('a merely long week is not 24/7', () => {
    expect(parseOpeningHours('Mo-Su 06:00-23:00', NYC)?.isOpen24_7).toBe(false)
  })
})

describe('rule separators and modifiers', () => {
  test('a later rule overrides an earlier one', () => {
    expect(onDay('Mo-Su 09:00-17:00; Sa 10:00-14:00', SAT)).toEqual(['10:00-14:00'])
  })

  test('an explicit day off closes that day', () => {
    expect(onDay('Mo-Fr 09:00-17:00; Su off', SUN)).toEqual([])
  })

  test('a fallback rule does not blanket the confirmed hours', () => {
    // `|| "by appointment"` evaluates as unknown across every uncovered hour;
    // taken at face value the place would read as open around the clock.
    expect(onDay('Mo-Fr 09:00-17:00 || "by appointment"', MON)).toEqual([
      '09:00-17:00',
    ])
  })

  test('a comment does not disturb the hours', () => {
    expect(onDay('Mo-Fr 09:00-17:00 open "ring the bell"', MON)).toEqual([
      '09:00-17:00',
    ])
  })
})

describe('wide-range selectors', () => {
  test('hours in force this season are reported', () => {
    const inSeason = parseOpeningHours('Jan-Dec Mo-Fr 09:00-18:00', NYC)
    expect(inSeason?.regularHours.length).toBeGreaterThan(0)
  })

  test('a month range excludes the whole year but now yields nothing', () => {
    // Whichever day the suite runs, one of these two is out of season.
    const first = parseOpeningHours('Jan-Mar Mo-Su 09:00-18:00', NYC)
    const second = parseOpeningHours('Jul-Sep Mo-Su 09:00-18:00', NYC)
    const counts = [first, second].map(r => r?.regularHours.length ?? 0)

    expect(Math.min(...counts)).toBe(0)
  })
})

describe('solar times', () => {
  test('resolve against the place clock, not the server clock', () => {
    // The library reads suncalc's instants with local getters, so on our UTC
    // containers a New York sunrise lands around 10:00 instead of 06:00.
    const august = parseOpeningHours('sunrise-sunset', NYC)
    const spans = august?.regularHours ?? []

    expect(spans.length).toBeGreaterThan(0)
    for (const span of spans) {
      const hour = Number(span.open.slice(0, 2))
      expect(hour).toBeGreaterThanOrEqual(3)
      expect(hour).toBeLessThanOrEqual(9)
    }
  })

  test('sunset falls in the evening', () => {
    for (const span of parseOpeningHours('sunrise-sunset', NYC)?.regularHours ?? []) {
      const hour = Number(span.close.slice(0, 2))
      expect(hour).toBeGreaterThanOrEqual(15)
      expect(hour).toBeLessThanOrEqual(22)
    }
  })

  test('an offset shifts the solar time', () => {
    const plain = parseOpeningHours('sunrise-sunset', NYC)!.regularHours[0]
    const delayed = parseOpeningHours('(sunrise+01:00)-sunset', NYC)!.regularHours[0]

    const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
    expect(minutes(delayed.open) - minutes(plain.open)).toBe(60)
  })

  test('solar times move from one day to the next', () => {
    const opens = new Set(
      (parseOpeningHours('sunrise-sunset', NYC)?.regularHours ?? []).map(h => h.open),
    )
    // A fixed 06:00 stand-in would collapse to a single value.
    expect(opens.size).toBeGreaterThan(1)
  })

  test('coordinates are required, and their absence is survivable', () => {
    expect(() => parseOpeningHours('sunrise-sunset', { timezone: 'UTC' })).not.toThrow()
  })
})

describe('malformed and empty values', () => {
  test.each([null, undefined, '', '   '])('%p yields nothing at all', value => {
    expect(parseOpeningHours(value, NYC)).toBeNull()
  })

  test('an unparseable value keeps the mapper\'s original string', () => {
    const parsed = parseOpeningHours('nonsense !! not hours', NYC)

    expect(parsed?.regularHours).toEqual([])
    expect(parsed?.rawText).toBe('nonsense !! not hours')
  })

  test('the raw string is preserved alongside a good parse', () => {
    expect(parseOpeningHours('Mo-Fr 09:00-17:00', NYC)?.rawText).toBe(
      'Mo-Fr 09:00-17:00',
    )
  })
})

describe('timezone frame', () => {
  test('fixed clock times are reported as written, whatever the zone', () => {
    // 09:00 in Tokyo is 09:00 on the page, not 09:00 shifted into UTC.
    for (const timezone of ['Asia/Tokyo', 'Pacific/Auckland', 'America/Los_Angeles']) {
      expect(onDay('Mo 09:00-17:00', MON, { ...NYC, timezone })).toEqual([
        '09:00-17:00',
      ])
    }
  })

  test('an unknown timezone does not lose the hours', () => {
    expect(onDay('Mo 09:00-17:00', MON, { ...NYC, timezone: 'Not/AZone' })).toEqual([
      '09:00-17:00',
    ])
  })
})
