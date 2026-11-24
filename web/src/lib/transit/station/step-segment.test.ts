import { describe, expect, it } from 'vitest'
import type { GuidanceStep, StationWalk } from '@server/types/station-guidance.types'
import { lineBounds, stepLevel, stepSegment } from './step-segment'

const end = (level: number | null) => ({ id: 'x', kind: 'platform' as const, name: null, lat: 0, lng: 0, level })

const step = (over: Partial<GuidanceStep>): GuidanceStep => ({
  type: 'walk', instruction: '', distance: 10, duration: 10, fromLevel: null, toLevel: null,
  levelChange: null, landmark: null, bridged: false, fromVertex: 0, toVertex: 0, ...over,
})

const walk = (steps: GuidanceStep[], vertexLevels: (number | null)[] = [-1, -1, -2, -2]): StationWalk => ({
  source: 'graph', estimate: false, seconds: 60, uncertaintyS: 5, metres: 80, levels: 1,
  from: end(-1), to: end(-2),
  geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0], [2, 1], [3, 1]] },
  vertexLevels,
  steps,
})

const transfer = walk([
  step({ fromVertex: 0, toVertex: 1, fromLevel: -1, toLevel: -1 }),
  step({ type: 'stairs', fromVertex: 1, toVertex: 2, fromLevel: -1, toLevel: -2, levelChange: -1 }),
  step({ type: 'platform', fromVertex: 2, toVertex: 3 }),
])

describe('stepSegment', () => {
  it('takes the vertices a step covers, both ends included', () => {
    expect(stepSegment(transfer, 0)).toEqual({ coordinates: [[0, 0], [1, 0]], level: -1 })
  })

  it('puts a change of level on the floor it reaches', () => {
    expect(stepSegment(transfer, 1)).toEqual({ coordinates: [[1, 0], [2, 1]], level: -2 })
  })

  it('reads the floor off the line when the step gives none', () => {
    expect(stepSegment(transfer, 2)?.level).toBe(-2)
    expect(stepLevel(walk([step({ fromVertex: 0, toVertex: 1 })], [null, null]), 0)).toBeNull()
  })

  it('keeps a step that runs past the line on it', () => {
    const odd = walk([step({ fromVertex: 3, toVertex: 9 }), step({ fromVertex: 2, toVertex: 1 })])
    expect(stepSegment(odd, 0)?.coordinates).toEqual([[3, 1]])
    expect(stepSegment(odd, 1)?.coordinates).toEqual([[2, 1]])
  })

  it('has nothing for a missing step or a walk without a line', () => {
    expect(stepSegment(transfer, 5)).toBeNull()
    expect(stepSegment({ ...transfer, geometry: undefined }, 0)).toBeNull()
  })
})

describe('lineBounds', () => {
  it('boxes the coordinates', () => {
    expect(lineBounds([[1, 0], [2, 1], [0, 3]])).toEqual({ minLng: 0, minLat: 0, maxLng: 2, maxLat: 3 })
    expect(lineBounds([])).toBeNull()
  })
})
