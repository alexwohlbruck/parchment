import { describe, expect, test } from 'vitest'
import { badgeWidth, tripBarScale } from './trip-bar-scale'

const T0 = Date.parse('2026-11-12T02:00:00Z')
const at = (min: number) => new Date(T0 + min * 60000).toISOString()
const leg = (mode: string, from: number, minutes: number, lineName?: string) => ({
  mode,
  startTime: at(from),
  duration: minutes * 60,
  lineName,
})

describe('tripBarScale', () => {
  test('stays time-proportional when every ride has room for its badge', () => {
    const x = tripBarScale([leg('walking', 0, 10), leg('transit', 10, 50, 'A')], T0, T0 + 60 * 60000, 600)
    expect(x(T0 + 10 * 60000)).toBeCloseTo(100)
    expect(x(T0 + 60 * 60000)).toBeCloseTo(600)
  })

  test('widens a short ride to its badge and shrinks the rest to keep the total', () => {
    const segments = [leg('transit', 0, 58, 'Q'), leg('walking', 58, 1), leg('transit', 59, 1, 'M101')]
    const x = tripBarScale(segments, T0, T0 + 60 * 60000, 300)
    const last = x(T0 + 60 * 60000) - x(T0 + 59 * 60000)
    expect(last).toBeCloseTo(badgeWidth(segments[2]) + 6)
    expect(x(T0 + 60 * 60000)).toBeCloseTo(300)
    expect(x(T0 + 58 * 60000)).toBeLessThan(290)
  })

  test('a word bullet needs more room than a letter', () => {
    expect(badgeWidth(leg('transit', 0, 1, 'M101'))).toBeGreaterThan(badgeWidth(leg('transit', 0, 1, 'Q')))
    expect(badgeWidth(leg('cycling', 0, 1))).toBe(22)
  })
})
