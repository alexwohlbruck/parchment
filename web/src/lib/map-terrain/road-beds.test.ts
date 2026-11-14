import { describe, expect, test } from 'vitest'
import { mercator, metresPerUnit } from '@/lib/map-decks/decks'
import { carvedAt } from './carve'
import { bedCarvings } from './road-beds'

describe('bedCarvings', () => {
  const points = [mercator([-74, 40.7]), mercator([-73.999, 40.7])]
  const [fill] = bedCarvings({ key: 'bed:1:0', points, floor: [17, 18], half: 5, level: false })
  const middle: [number, number] = [(points[0][0] + points[1][0]) / 2, points[0][1]]

  test('fills the carriageway up to its floor, coming down just past its edge', () => {
    expect(fill.fill).toBe(true)
    const off = (m: number): [number, number] => [middle[0], middle[1] + m / metresPerUnit(middle[1])]
    expect(carvedAt(fill, off(4))).toBeCloseTo(17.5, 5)
    expect(carvedAt(fill, off(5.25))).toBeCloseTo(17.25, 5)
    expect(carvedAt(fill, off(6))).toBeNull()
  })

  test('runs on past its ends, so no ground shows where it meets a deck', () => {
    const past = (m: number): [number, number] => [points[1][0] + m / metresPerUnit(points[1][1]), points[1][1]]
    expect(carvedAt(fill, past(1.5))).toBeCloseTo(18, 1)
    expect(carvedAt(fill, past(2.5))).toBeNull()
  })

  test('cuts a level bed down to its floor as well as filling it', () => {
    const carvings = bedCarvings({ key: 'bed:1:0', points, floor: [17, 18], half: 5, level: true })
    expect(carvings.map(f => f.fill)).toEqual([true, false])
    expect(carvedAt(carvings[1], middle)).toBeCloseTo(17.5, 5)
  })
})
