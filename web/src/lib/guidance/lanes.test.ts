import { describe, expect, test } from 'vitest'
import { laneHint, lanePlan, type RoadGlyph } from './lanes'

const at = { lat: 40, lng: -74 }
/** A glyph `back` metres before the stop line, `across` metres right of the centre, heading north. */
const glyph = (name: string, back: number, across: number, direction = 0): RoadGlyph => ({
  glyph: name,
  direction,
  position: {
    lat: at.lat - back / 111_320,
    lng: at.lng + across / (111_320 * Math.cos((at.lat * Math.PI) / 180)),
  },
})

const approach = [
  glyph('road-arrow-left', 20, -4.5),
  glyph('road-arrow-through', 20, -1.5),
  glyph('road-arrow-through', 20, 1.5),
  glyph('road-arrow-through-right', 20, 4.5),
  // An earlier row of the same arrows, and the other direction's.
  glyph('road-arrow-left', 60, -4.5),
  glyph('road-arrow-right', 20, -9, 180),
]

describe('lanePlan', () => {
  test('reads the lanes left to right from the row nearest the stop line', () => {
    const plan = lanePlan(approach, at, 0, 'right')
    expect(plan?.lanes.map(l => l.arrows.join('+'))).toEqual(['left', 'through', 'through', 'through+right'])
  })

  test('a right turn uses the rightmost lane that turns right', () => {
    const plan = lanePlan(approach, at, 0, 'right')!
    expect(plan.lanes.map(l => [l.valid, l.recommended])).toEqual([[false, false], [false, false], [false, false], [true, true]])
  })

  test('straight on recommends a middle through lane', () => {
    const plan = lanePlan(approach, at, 0, 'straight')!
    expect(plan.lanes.map(l => l.valid)).toEqual([false, true, true, true])
    expect(plan.lanes.findIndex(l => l.recommended)).toBe(2)
  })

  test('nothing without at least two painted lanes', () => {
    expect(lanePlan([glyph('road-arrow-left', 20, -1.5)], at, 0, 'left')).toBeNull()
    expect(lanePlan(approach, at, 90, 'left')).toBeNull()
  })
})

describe('laneHint', () => {
  test('names the lanes to use only when some do not work', () => {
    expect(laneHint(lanePlan(approach, at, 0, 'right')!)).toEqual({ side: 'right', count: 1 })
    expect(laneHint(lanePlan(approach, at, 0, 'left')!)).toEqual({ side: 'left', count: 1 })
    expect(laneHint(lanePlan(approach, at, 0, 'straight')!)).toEqual({ side: 'right', count: 3 })
  })
})
