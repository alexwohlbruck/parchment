import { describe, expect, test } from 'vitest'
import { comfortableShare, legStretches, streetKey } from './leg-stretches'
import type { RouteEdgeSegment, RouteInstruction } from '@/types/directions.types'

const at = { lat: 0, lng: 0 }
const step = (streetName: string | null, distance: number, text = `onto ${streetName}`): RouteInstruction =>
  ({ type: 'turn', modifier: 'right', text, coordinate: at, distance, duration: distance / 5, ...(streetName && { streetName }) })
const arrive: RouteInstruction = { type: 'destination', text: 'Arrive', coordinate: at, distance: 0, duration: 0 }

/** The opening of a real Charlotte bike leg, as the router returned it. */
const uptown = [
  step(null, 4), step(null, 12), step(null, 40),
  step('East Martin Luther King Jr Boulevard', 99),
  step(null, 9),
  step('Uptown CycleLink', 146), step('Uptown CycleLink', 344),
  step('East 4th Street', 5),
  step('South Davidson Street', 410), step('North Davidson Street', 353),
  step('East 10th Street', 178), step('Little Sugar Creek Greenway', 13), step('East 10th Street', 685),
  arrive,
]

describe('legStretches', () => {
  test('groups a leg into the streets you ride, not every turn', () => {
    const names = legStretches({ instructions: uptown }).map(s => s.name)
    expect(names).toEqual([
      'East Martin Luther King Jr Boulevard',
      'Uptown CycleLink',
      'Davidson Street',
      'East 10th Street',
    ])
  })

  test('a jog onto another street and back stays inside the street', () => {
    const tenth = legStretches({ instructions: uptown }).at(-1)!
    expect(tenth.from).toBe(1422)
    expect(tenth.to).toBe(2298)
    expect(tenth.exits).toEqual([])
  })

  test('a jog between two streets is kept as a way out of the first', () => {
    const cycleLink = legStretches({ instructions: uptown })[1]
    expect(cycleLink.exits.map(e => e.streetName)).toEqual(['East 4th Street', 'South Davidson Street'])
  })

  test('an unnamed lead-in too short to remember opens the first street', () => {
    expect(legStretches({ instructions: uptown })[0].from).toBe(0)
  })

  test('stretches cover the leg end to end', () => {
    const stretches = legStretches({ instructions: uptown })
    expect(stretches[0].from).toBe(0)
    stretches.slice(1).forEach((s, i) => expect(s.from).toBe(stretches[i].to))
  })

  test('takes the surface most of the stretch is on, and its bike-friendliness', () => {
    const edges: RouteEdgeSegment[] = [
      { startDistance: 0, endDistance: 300, roadClass: 'cycleway', bikePriority: 1.3 },
      { startDistance: 300, endDistance: 400, roadClass: 'primary', bikePriority: 0.5 },
    ]
    const [only] = legStretches({ mode: 'cycling', instructions: [step('Path', 400)], edgeSegments: edges })
    expect(only.surface).toBe('protected')
    expect(only.quality?.group).toBe('high')
  })

  test('names a sustained climb', () => {
    const edges: RouteEdgeSegment[] = [{ startDistance: 0, endDistance: 200, averageSlope: 6 }]
    expect(legStretches({ instructions: [step('Hill St', 200)], edgeSegments: edges })[0].climb).toBe(6)
  })
})

test('streetKey ignores the direction prefix', () => {
  expect(streetKey('South Davidson Street')).toBe(streetKey('N Davidson Street'))
})

test('comfortableShare weighs edges by length', () => {
  const edges: RouteEdgeSegment[] = [
    { startDistance: 0, endDistance: 75, bikePriority: 1.2 },
    { startDistance: 75, endDistance: 100, bikePriority: 0.5 },
  ]
  expect(comfortableShare({ edgeSegments: edges })).toBe(0.75)
})
