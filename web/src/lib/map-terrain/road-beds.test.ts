import { describe, expect, test } from 'vitest'
import { mercator, metresPerUnit } from '@/lib/map-decks/decks'
import { carvedAt } from './carve'
import { bedCarving } from './road-beds'

describe('bedCarving', () => {
  const points = [mercator([-74, 40.7]), mercator([-73.999, 40.7])]
  const fill = bedCarving({ key: 'bed:1:0', points, floor: [17, 18], half: 5 })
  const middle: [number, number] = [(points[0][0] + points[1][0]) / 2, points[0][1]]

  test('fills the carriageway up to its floor, coming down just past its edge', () => {
    expect(fill.fill).toBe(true)
    const off = (m: number): [number, number] => [middle[0], middle[1] + m / metresPerUnit(middle[1])]
    expect(carvedAt(fill, off(4))).toBeCloseTo(17.5, 5)
    expect(carvedAt(fill, off(5.25))).toBeCloseTo(17.25, 5)
    expect(carvedAt(fill, off(6))).toBeNull()
  })
})
