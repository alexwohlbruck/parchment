import { describe, expect, test } from 'bun:test'
import { cumulativeDistances, pointAlong, projectAlong } from './route-projection'

const line = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 0.01 },
  { lat: 0.01, lng: 0.01 },
]

describe('route projection', () => {
  test('measures along the line', () => {
    const cumulative = cumulativeDistances(line)
    expect(cumulative[2]).toBeCloseTo(2226, -1)
  })

  test('projects an off-line point onto its nearest leg', () => {
    const { along, offset } = projectAlong(line, { lat: 0.005, lng: 0.011 })
    expect(along).toBeCloseTo(1113 + 556, -1)
    expect(offset).toBeCloseTo(111, -1)
  })

  test('finds the point at a distance, clamped to the ends', () => {
    expect(pointAlong(line, 1113 + 556).lat).toBeCloseTo(0.005, 3)
    expect(pointAlong(line, 1e6)).toEqual(line[2])
    expect(pointAlong(line, -5)).toEqual(line[0])
  })
})
