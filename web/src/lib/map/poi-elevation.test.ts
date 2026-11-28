import { describe, expect, test } from 'vitest'
import { footprintIndex, LEVEL_HEIGHT, poiElevation, raisedDiff, type BuildingFootprint } from './poi-elevation'

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

  test('a level tag outside every building stays on the ground', () => {
    expect(poiElevation([-74.02, 40.71], 4, near)).toBe(0)
  })

  test('a courtyard hole is not inside the building', () => {
    const ring = square(0, 0, 0.001, 30)
    ring.rings.push([[0.0004, 0.0004], [0.0006, 0.0004], [0.0006, 0.0006], [0.0004, 0.0006], [0.0004, 0.0004]])
    expect(poiElevation([0.0005, 0.0005], undefined, footprintIndex([ring]))).toBe(0)
  })
})

describe('raisedDiff', () => {
  const poi = (id: number | undefined, _elev: number) => ({ id, properties: { _elev } })

  test('adds what is new or at another height, and removes what is gone', () => {
    const shown = new Map<string | number, number>([[1, 0], [2, 12], [3, 0]])
    const moved = poi(2, 20)
    const fresh = poi(4, 0)
    expect(raisedDiff(shown, [poi(1, 0), moved, fresh])).toEqual({ remove: [3], add: [moved, fresh] })
  })

  test('only adds what is not shown when asked to', () => {
    const fresh = poi(4, 0)
    expect(raisedDiff(new Map([[2, 12], [3, 0]]), [poi(2, 20), fresh], true)).toEqual({ remove: [], add: [fresh] })
  })

  test('changes nothing for the same set', () => {
    expect(raisedDiff(new Map([[1, 5]]), [poi(1, 5)])).toEqual({ remove: [], add: [] })
  })

  test('gives up where two features share an id or one has none', () => {
    expect(raisedDiff(new Map(), [poi(1, 0), poi(1, 0)])).toBeNull()
    expect(raisedDiff(new Map(), [poi(undefined, 0)])).toBeNull()
  })
})
