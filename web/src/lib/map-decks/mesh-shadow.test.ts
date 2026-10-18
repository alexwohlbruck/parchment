import { describe, expect, test } from 'vitest'
import { groundBeneath } from './mesh-shadow'
import { metresPerUnit, type Point } from './decks'

describe('groundBeneath', () => {
  const origin: Point = [0.25, 0.4]
  const unit = metresPerUnit(origin[1])

  test('reads the ground under each vertex once per spot, stretched and in mercator units', () => {
    const reads: Point[] = []
    const at = (p: Point) => {
      reads.push(p)
      return p[0] > origin[0] ? 20 : 10
    }
    // A pier's foot and head on one spot, then a vertex a few hundred metres east.
    const position = [0, 0, 0, 0, 0, 9, 1e-5, 0, 9]
    const ground = groundBeneath(position, 3, origin, at, 1.5)
    expect(reads).toHaveLength(2)
    expect(reads[0]).toEqual(origin)
    expect(ground[0] * unit).toBeCloseTo(15, 3)
    expect(ground[1]).toBe(ground[0])
    expect(ground[2] * unit).toBeCloseTo(30, 3)
  })

  test('leaves a vertex with no ground known standing on itself, so it casts nothing', () => {
    expect([...groundBeneath([0, 0, 7, 0, 1e-5, 7], 2, origin, p => (p[1] > origin[1] ? NaN : null))]).toEqual([7, 7])
  })
})
