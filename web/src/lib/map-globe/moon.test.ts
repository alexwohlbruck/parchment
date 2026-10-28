import { describe, expect, it } from 'vitest'
import { moonPosition, MOON_RADIUS } from './moon'
import { globeSunDirection } from '@/lib/daynight/daynight'

// USNO primary phases: https://aa.usno.navy.mil/calculated/moon/phases?date=2026-10-01&format=p&nump=6
const phases = [
  ['new', '2026-10-10T15:50:00Z', 0],
  ['first quarter', '2026-10-18T16:12:00Z', 0.5],
  ['full', '2026-10-26T04:12:00Z', 1],
  ['last quarter', '2026-11-01T20:28:00Z', 0.5],
] as const

describe('lunar globe position', () => {
  it.each(phases)('produces the illumination for %s Moon', (_, timestamp, fraction) => {
    const date = new Date(timestamp)
    const moon = moonPosition(date)
    const sun = globeSunDirection(date)
    const cosine = moon.reduce((sum, value, i) => sum + value * sun[i], 0) / Math.hypot(...moon)
    expect((1 - cosine) / 2).toBeCloseTo(fraction, 1)
    expect(Math.hypot(...moon) * 6371).toBeGreaterThan(350000)
    expect(Math.hypot(...moon) * 6371).toBeLessThan(410000)
  })

  it.each([
    ['2026-10-18T16:12:00Z', 1],
    ['2026-11-01T20:28:00Z', -1],
  ])('lights opposite limbs for waxing and waning at %s', (timestamp, direction) => {
    const date = new Date(timestamp)
    const moon = moonPosition(date)
    const sun = globeSunDirection(date)
    const east = [-moon[2], 0, moon[0]]
    const illumination = east.reduce((sum, value, i) => sum + value * sun[i], 0) / Math.hypot(...east)
    expect(illumination * direction).toBeGreaterThan(0.9)
  })

  it('keeps the angular diameter near half a degree', () => {
    const distance = Math.hypot(...moonPosition(new Date('2026-10-28T00:00:00Z')))
    const diameter = 2 * Math.asin(MOON_RADIUS / distance) * 180 / Math.PI
    expect(diameter).toBeGreaterThan(0.48)
    expect(diameter).toBeLessThan(0.57)
  })

  it('moves west with Earth’s rotation and advances east in its orbit', () => {
    const date = new Date('2026-10-28T00:00:00Z')
    const first = moonPosition(date)
    const later = moonPosition(new Date(date.getTime() + 6 * 3600000))
    const a = Math.atan2(first[0], first[2])
    const b = Math.atan2(later[0], later[2])
    const rotation = Math.atan2(Math.sin(b - a), Math.cos(b - a)) * 180 / Math.PI
    expect(rotation).toBeGreaterThan(-90)
    expect(rotation).toBeLessThan(-85)
  })
})
