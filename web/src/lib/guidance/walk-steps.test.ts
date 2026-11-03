import { describe, expect, test } from 'vitest'
import type { RouteEdgeSegment, RouteInstruction } from '@/types/directions.types'
import { maneuverKind } from '@/lib/directions/maneuver'
import { buildNavRoute, type NavRoute } from './nav-route'
import { polyline } from './test-routes'

type Step = Partial<RouteInstruction> & { at: number }

function walk(legs: [number, number][], steps: Step[], edges: Partial<RouteEdgeSegment>[] = [], mode = 'walking'): NavRoute {
  const line = polyline(legs)
  const near = (s: number) => line[Math.round(s / 10)] ?? line.at(-1)!
  const length = legs.reduce((sum, [, m]) => sum + m, 0)
  return buildNavRoute([{
    mode,
    geometry: line,
    instructions: [
      ...steps.map(({ at, ...step }) => ({ type: 'turn', text: 'GraphHopper', coordinate: near(at), distance: 10, duration: 7, ...step })),
      { type: 'destination', text: '', coordinate: line.at(-1)!, distance: 0, duration: 0 },
    ],
    edgeSegments: [{ startDistance: 0, endDistance: length, roadClass: 'footway' }, ...edges].map(e => ({ startDistance: 0, endDistance: 0, ...e })),
  }])
}

const summary = (route: NavRoute) => route.steps.map(s => [maneuverKind(s.instruction), s.instruction.streetName ?? null])

describe('walkingSteps', () => {
  test('a crosswalk that jogs across a side street says nothing', () => {
    const route = walk(
      [[0, 300], [330, 20], [0, 300]],
      [
        { at: 0, type: 'depart', streetName: 'Hawthorne Lane' },
        { at: 300, modifier: 'slight-right' },
        { at: 302, modifier: 'left', streetName: 'Hawthorne Lane' },
      ],
      [{ startDistance: 300, endDistance: 320, roadClass: 'footway', crossing: 'marked', crossingName: 'East 7th Street' }],
    )
    expect(summary(route)).toEqual([['straight', 'Hawthorne Lane'], ['arrive', null]])
  })

  test('the kinks of a corner and its crosswalk are one turn, crossing after it', () => {
    const route = walk(
      [[90, 300], [0, 15], [0, 300]],
      [
        { at: 0, type: 'depart', streetName: 'East 39th Street' },
        { at: 300, modifier: 'slight-left' },
        { at: 301, modifier: 'left', streetName: 'Madison Avenue' },
        { at: 314, modifier: 'left' },
        { at: 315, modifier: 'right', streetName: 'Madison Avenue' },
      ],
      [{ startDistance: 301, endDistance: 314, roadClass: 'footway', crossing: 'traffic_signals', crossingName: 'East 39th Street' }],
    )
    expect(summary(route)).toEqual([['straight', 'East 39th Street'], ['left', 'Madison Avenue'], ['arrive', null]])
    expect(route.steps[1]).toMatchObject({ index: 1, crossing: { road: 'East 39th Street', signals: true, first: false } })
    expect(route.steps[1].instruction.text).toBe('')
  })

  test('the side of a corner it is crossed on names the street', () => {
    const route = walk(
      [[0, 300], [0, 15], [270, 300]],
      [
        { at: 0, type: 'depart', streetName: 'Madison Avenue' },
        { at: 300, modifier: 'straight' },
        { at: 315, modifier: 'left', streetName: 'East 40th Street' },
      ],
      [{ startDistance: 300, endDistance: 315, roadClass: 'footway', crossing: 'traffic_signals' }],
    )
    expect(route.steps[1]).toMatchObject({ crossing: { road: 'East 40th Street', first: true } })
    expect(maneuverKind(route.steps[1].instruction)).toBe('left')
  })

  test('a sidewalk passing a driveway is not a crossing', () => {
    const route = walk(
      [[90, 300], [0, 300]],
      [{ at: 0, type: 'depart', streetName: 'Trade Street' }, { at: 300, modifier: 'left', streetName: 'Tryon Street' }],
      [{ startDistance: 300, endDistance: 330, roadClass: 'footway', crossing: 'unmarked' }],
    )
    expect(route.steps[1].crossing).toBeUndefined()
    expect(route.steps[1].instruction.text).toBe('GraphHopper')
  })

  test('a fork between unnamed paths is still a choice', () => {
    const route = walk([[0, 300], [20, 300]], [{ at: 0, type: 'depart' }, { at: 300, type: 'keep-right' }])
    expect(summary(route).map(([kind]) => kind)).toEqual(['straight', 'keep-right', 'arrive'])
  })

  test('only walking is reshaped', () => {
    const steps: Step[] = [{ at: 0, type: 'depart', streetName: 'A' }, { at: 300, modifier: 'slight-right' }, { at: 302, modifier: 'left', streetName: 'A' }]
    expect(walk([[0, 300], [330, 20], [0, 300]], steps, [], 'driving').steps).toHaveLength(4)
  })
})
