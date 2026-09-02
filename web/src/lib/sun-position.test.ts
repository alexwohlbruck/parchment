/**
 * The solar position, checked against values that are true by definition or
 * independently published, rather than against itself.
 *
 * Tolerances are a degree or so: the formulation is low-precision by design and
 * ignores refraction, and a shadow on a map cannot show better than that.
 */
import { describe, test, expect } from 'vitest'
import { sunPosition } from './sun-position'

const DEG = 180 / Math.PI
const deg = (rad: number) => rad * DEG

/** Smallest angle between two bearings, in degrees. */
function bearingDelta(a: number, b: number): number {
  return Math.abs(((a - b) % 360 + 540) % 360 - 180)
}

describe('sunPosition', () => {
  /**
   * At an equinox the sun rises due east and sets due west everywhere on earth,
   * and its declination is zero — a fact of geometry rather than of any table.
   */
  test('rises due east at the equinox', () => {
    // 2026-03-20 equinox; sunrise at the equator is ~06:00 local solar time.
    const { azimuth } = sunPosition(new Date('2026-03-20T06:00:00Z'), 0, 0)
    expect(bearingDelta(deg(azimuth), 90)).toBeLessThan(1.5)
  })

  /**
   * Solar noon puts the sun due south for anywhere north of the tropics. On the
   * Greenwich meridian that is 12:00 UT, give or take the equation of time.
   */
  test('is due south at local noon in the northern hemisphere', () => {
    const { azimuth, altitude } = sunPosition(new Date('2026-06-21T12:02:00Z'), 51.48, 0)
    expect(bearingDelta(deg(azimuth), 180)).toBeLessThan(1.5)
    // Greenwich at the June solstice: 90 - 51.48 + 23.44 = 61.96° up.
    expect(deg(altitude)).toBeCloseTo(61.96, 0)
  })

  /**
   * Noon altitude at the solstices is fixed by latitude and obliquity alone:
   * 90 - |lat| ± 23.44. NYC is 40.71 N, so 72.73 in June and 25.85 in December.
   */
  test('solstice noon altitude follows latitude and obliquity', () => {
    const june = sunPosition(new Date('2026-06-21T16:57:00Z'), 40.7128, -74.006)
    expect(deg(june.altitude)).toBeCloseTo(72.73, 0)

    const december = sunPosition(new Date('2026-12-21T16:56:00Z'), 40.7128, -74.006)
    expect(deg(december.altitude)).toBeCloseTo(25.85, 0)
  })

  test('the sun is below the horizon at local midnight', () => {
    const { altitude } = sunPosition(new Date('2026-06-21T05:00:00Z'), 40.7128, -74.006)
    expect(deg(altitude)).toBeLessThan(0)
  })

  /** Southern-hemisphere noon puts the sun due north, not due south. */
  test('is due north at noon in the southern hemisphere', () => {
    const { azimuth, altitude } = sunPosition(new Date('2026-06-21T02:00:00Z'), -33.87, 151.21)
    expect(bearingDelta(deg(azimuth), 0)).toBeLessThan(2)
    expect(deg(altitude)).toBeGreaterThan(0)
  })

  test('azimuth stays inside one turn', () => {
    for (let h = 0; h < 24; h++) {
      const { azimuth } = sunPosition(new Date(Date.UTC(2026, 7, 26, h)), 40.7128, -74.006)
      expect(azimuth).toBeGreaterThanOrEqual(0)
      expect(azimuth).toBeLessThan(2 * Math.PI)
    }
  })

  /** The sun tracks westward through the day: bearing increases from morning to evening. */
  test('moves west across the day', () => {
    const morning = deg(sunPosition(new Date('2026-08-26T13:00:00Z'), 40.7128, -74.006).azimuth)
    const noon = deg(sunPosition(new Date('2026-08-26T17:00:00Z'), 40.7128, -74.006).azimuth)
    const evening = deg(sunPosition(new Date('2026-08-26T21:00:00Z'), 40.7128, -74.006).azimuth)
    expect(morning).toBeLessThan(noon)
    expect(noon).toBeLessThan(evening)
  })
})
