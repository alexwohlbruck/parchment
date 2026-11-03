import { describe, expect, it } from 'vitest'
import { galacticRotation } from './celestial'
import { siderealAngle } from '@/lib/map/sun-position'

const date = new Date('2026-10-20T18:00:00Z')
function project(ra: number, dec: number) {
  const lng = ra * Math.PI / 180 - siderealAngle(date)
  const lat = dec * Math.PI / 180
  const vector = [Math.sin(lng) * Math.cos(lat), Math.sin(lat), Math.cos(lng) * Math.cos(lat)]
  const matrix = galacticRotation(date)
  return [0, 1, 2].map(row => vector.reduce((sum, value, col) => sum + value * matrix[col * 3 + row], 0))
}

describe('Milky Way orientation', () => {
  it('places the Galactic Centre in the middle of the panorama', () => {
    const centre = project(266.4051, -28.936175)
    expect(centre[0]).toBeCloseTo(1, 4)
    expect(Math.abs(centre[1])).toBeLessThan(0.002)
    expect(Math.abs(centre[2])).toBeLessThan(0.002)
  })

  it('places the north galactic pole at the top of the sky', () => {
    const north = project(192.85948, 27.12825)
    expect(north[0]).toBeCloseTo(0, 5)
    expect(north[1]).toBeCloseTo(0, 5)
    expect(north[2]).toBeCloseTo(1, 5)
  })

  it('turns the sky with sidereal time without changing its scale', () => {
    const first = galacticRotation(date)
    const later = galacticRotation(new Date(date.getTime() + 6 * 3600_000))
    const dot = [0, 1, 2].reduce((sum, row) => sum + first[row] * later[row], 0)
    expect(Math.abs(dot)).toBeLessThan(0.01)
    expect(Math.hypot(...later.slice(0, 3))).toBeCloseTo(1, 6)
  })
})
