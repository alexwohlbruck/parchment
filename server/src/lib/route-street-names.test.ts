import { describe, expect, test } from 'bun:test'
import { nameSidewalkSteps, streetAlong } from './route-street-names'
import type { RouteEdgeSegment, RouteInstruction } from '../types/unified-routing.types'

const step = (text: string, distance: number, over: Partial<RouteInstruction> = {}): RouteInstruction =>
  ({ type: 'turn', text, distance, duration: 0, coordinate: { lat: 0, lng: 0 }, ...over }) as RouteInstruction

const edges: RouteEdgeSegment[] = [
  { startDistance: 0, endDistance: 6, streetName: 'West 23rd Street', streetNameSource: 'geometry' },
  { startDistance: 6, endDistance: 18 },
  { startDistance: 18, endDistance: 70, streetName: 'East 23rd Street', streetNameSource: 'geometry' },
  { startDistance: 70, endDistance: 73, streetName: 'Madison Avenue', streetNameSource: 'geometry' },
]
const onto = (action: string, road: string) => `${action} onto ${road}`

describe('streetAlong', () => {
  test('takes the street most of the stretch runs beside, across crossings between', () => {
    expect(streetAlong(edges, 0, 73)?.streetName).toBe('East 23rd Street')
  })

  test('ignores a sliver of street at a corner', () => {
    expect(streetAlong(edges, 68, 73)).toBeNull()
  })
})

describe('nameSidewalkSteps', () => {
  test('names unnamed steps and leaves named ones, and the arrival, as they are', () => {
    const named = nameSidewalkSteps(
      [step('Turn right', 73), step('Turn left onto 5th Avenue', 10, { streetName: '5th Avenue' }), step('Arrive', 0, { type: 'destination' })],
      edges,
      onto,
    )
    expect(named.map(s => [s.text, s.streetName, s.streetNameSource])).toEqual([
      ['Turn right onto East 23rd Street', 'East 23rd Street', 'geometry'],
      ['Turn left onto 5th Avenue', '5th Avenue', undefined],
      ['Arrive', undefined, undefined],
    ])
  })

  test('returns the steps untouched when no edge has a street name', () => {
    const steps = [step('Turn right', 73)]
    expect(nameSidewalkSteps(steps, [{ startDistance: 0, endDistance: 73 }], onto)).toBe(steps)
  })
})
