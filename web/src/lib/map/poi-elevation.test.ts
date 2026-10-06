import { describe, expect, test } from 'vitest'
import { footprintIndex, LEVEL_HEIGHT, poiElevation, type BuildingFootprint } from './poi-elevation'

const square = (x: number, y: number, size: number, height: number): BuildingFootprint => ({
  rings: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]],
  height,
})

describe('poiElevation', () => {
  const tower = square(-74.012, 40.703, 0.001, 120)
  const low = square(-74.0118, 40.7032, 0.0004, 20)
  const near = footprintIndex([tower, low])
  const inside: [number, number] = [-74.0116, 40.7034]

  test('a POI inside a building sits on its tallest roof', () => {
    expect(poiElevation(inside, undefined, near)).toBeCloseTo(120.5)
  })

  test('a level tag places it at that storey', () => {
    expect(poiElevation(inside, 2, near)).toBeCloseTo(2 * LEVEL_HEIGHT + 0.5)
  })

  test('a level above the roof is capped at the roof', () => {
    expect(poiElevation(inside, 80, near)).toBeCloseTo(120.5)
  })

  test('basement and ground levels stay on the ground', () => {
    expect(poiElevation(inside, -3, near)).toBe(0)
    expect(poiElevation(inside, '0', near)).toBe(0)
  })

  test('a POI outside every building stays on the ground', () => {
    expect(poiElevation([-74.02, 40.71], undefined, near)).toBe(0)
  })

  test('a courtyard hole is not inside the building', () => {
    const ring = square(0, 0, 0.001, 30)
    ring.rings.push([[0.0004, 0.0004], [0.0006, 0.0004], [0.0006, 0.0006], [0.0004, 0.0006], [0.0004, 0.0004]])
    expect(poiElevation([0.0005, 0.0005], undefined, footprintIndex([ring]))).toBe(0)
  })
})
