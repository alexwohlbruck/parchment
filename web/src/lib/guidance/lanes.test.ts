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

describe('lanePlan at a divided crossroad', () => {
  // Delancey St westbound at the Bowery, bearing right onto Kenmare St: a row of
  // arrows at each carriageway's stop line, at different angles.
  const glyphs: RoadGlyph[] = [
    ['road-arrow-right', 265, 40.720362, -73.993781],
    ['road-arrow-through', 265, 40.720332, -73.993778],
    ['road-arrow-through', 265, 40.720301, -73.993775],
    ['road-arrow-left', 265, 40.720271, -73.993772],
    ['road-arrow-left', 292, 40.720183, -73.993466],
    ['road-arrow-through', 292, 40.720211, -73.993451],
    ['road-arrow-through', 292, 40.720239, -73.993436],
    ['road-arrow-right', 292, 40.720268, -73.993421],
  ].map(([glyph, direction, lat, lng]) => ({ glyph, direction, position: { lat, lng } }) as RoadGlyph)
  const plan = lanePlan(glyphs, { lat: 40.720302, lng: -73.993994 }, 265, 'slight-right')!

  test('reads only the row nearest the stop line', () => {
    expect(plan.lanes.map(l => l.arrows.join('+'))).toEqual(['left', 'through', 'through', 'right'])
  })

  test('a bend onto the road ahead keeps to the through lanes', () => {
    expect(plan.lanes.map(l => l.valid)).toEqual([false, true, true, false])
    expect(plan.lanes.findIndex(l => l.recommended)).toBe(2)
  })
})

describe('lanePlan for a slight turn', () => {
  test('uses lanes painted for it ahead of the through lanes', () => {
    const lanes = [glyph('road-arrow-through', 20, -1.5), glyph('road-arrow-slight-right', 20, 1.5)]
    expect(lanePlan(lanes, at, 0, 'slight-right')!.lanes.map(l => l.valid)).toEqual([false, true])
  })

  test('turns off with the turning lanes when nothing goes ahead', () => {
    const lanes = [glyph('road-arrow-left', 20, -1.5), glyph('road-arrow-right', 20, 1.5)]
    expect(lanePlan(lanes, at, 0, 'slight-right')!.lanes.map(l => l.valid)).toEqual([false, true])
  })
})

describe('laneHint', () => {
  test('names the lanes to use only when some do not work', () => {
    expect(laneHint(lanePlan(approach, at, 0, 'right')!)).toEqual({ side: 'right', count: 1 })
    expect(laneHint(lanePlan(approach, at, 0, 'left')!)).toEqual({ side: 'left', count: 1 })
    expect(laneHint(lanePlan(approach, at, 0, 'straight')!)).toEqual({ side: 'right', count: 3 })
  })
})
