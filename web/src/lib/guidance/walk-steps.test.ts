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

  test('crossing to the other side of the street walked along says so', () => {
    const route = walk(
      [[0, 300], [270, 15], [0, 300]],
      [
        { at: 0, type: 'depart', streetName: 'Sterling Place' },
        { at: 300, modifier: 'left' },
        { at: 315, modifier: 'right', streetName: 'Sterling Place' },
      ],
      [{ startDistance: 300, endDistance: 315, roadClass: 'footway', crossing: 'traffic_signals', crossingName: 'Sterling Place' }],
    )
    expect(summary(route)).toEqual([['straight', 'Sterling Place'], ['straight', 'Sterling Place'], ['arrive', null]])
    expect(route.steps[1].crossing).toEqual({ road: 'Sterling Place', signals: true, first: true, light: true })
  })

  test('turning onto a street says nothing of crossing the one it leaves', () => {
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
    expect(route.steps[1].crossing).toBeUndefined()
    expect(route.steps[1].instruction.text).toBe('')
  })

  test('a turn onto a path still says which street it then crosses', () => {
    const route = walk(
      [[90, 300], [0, 15], [0, 300]],
      [{ at: 0, type: 'depart', streetName: 'East 39th Street' }, { at: 301, modifier: 'left' }],
      [{ startDistance: 302, endDistance: 314, roadClass: 'footway', crossing: 'marked', crossingName: 'Park Avenue' }],
    )
    expect(route.steps[1].crossing).toEqual({ road: 'Park Avenue', signals: false, first: false })
  })

  test('a diagonal corner names both streets, in the order crossed', () => {
    const route = walk(
      [[0, 300], [0, 15], [270, 15], [0, 300]],
      [
        { at: 0, type: 'depart', streetName: 'Rogers Avenue' },
        { at: 315, modifier: 'left' },
        { at: 330, modifier: 'right', streetName: 'Rogers Avenue' },
      ],
      [
        { startDistance: 300, endDistance: 315, roadClass: 'footway', crossing: 'traffic_signals', crossingName: 'Sterling Place' },
        { startDistance: 315, endDistance: 330, roadClass: 'footway', crossing: 'traffic_signals', crossingName: 'Rogers Avenue' },
      ],
    )
    expect(route.steps[1].crossing).toEqual({ road: 'Sterling Place', then: 'Rogers Avenue', signals: true, first: true })
  })

  describe('crossing the street walked along', () => {
    const across = (edges: Partial<RouteEdgeSegment>[] = [], tags: Partial<RouteEdgeSegment> = {}) => walk(
      [[0, 300], [270, 15], [0, 300]],
      [
        { at: 0, type: 'depart', streetName: 'Madison Avenue' },
        { at: 300, modifier: 'left', streetName: 'East 40th Street' },
        { at: 315, modifier: 'right', streetName: 'Madison Avenue' },
      ],
      [{ startDistance: 300, endDistance: 315, roadClass: 'footway', crossing: 'traffic_signals', crossingName: 'Madison Avenue', ...tags }, ...edges],
    )

    test('names the corner it is crossed at', () => {
      expect(across().steps[1].crossing).toEqual({ road: 'Madison Avenue', at: 'East 40th Street', signals: true, first: true })
    })

    test('names the light when the corners passed before it had none', () => {
      const route = across([{ startDistance: 150, endDistance: 165, roadClass: 'footway', crossing: 'marked', crossingName: 'East 39th Street' }])
      expect(route.steps[1].crossing).toMatchObject({ at: 'East 40th Street', light: true })
    })

    test('carries how it is crossed', () => {
      const tags = { crossingIsland: true, buttonOperated: true, crossingDiagonal: true }
      expect(across([], tags).steps[1].crossing).toMatchObject({ island: true, button: true, diagonal: true })
      expect(across([], { crossing: 'unmarked' }).steps[1].crossing).toMatchObject({ unmarked: true, signals: false })
    })
  })

  test('doubling back to cross at the corner is one maneuver, crossing first', () => {
    const route = walk(
      [[270, 100], [0, 15], [90, 100]],
      [
        { at: 0, type: 'depart', streetName: 'Sterling Place' },
        { at: 100, modifier: 'right', streetName: 'Rogers Avenue' },
        { at: 115, modifier: 'right', streetName: 'Sterling Place' },
      ],
      [{ startDistance: 100, endDistance: 115, roadClass: 'footway', crossing: 'traffic_signals', crossingName: 'Sterling Place' }],
    )
    expect(summary(route)).toEqual([['straight', 'Sterling Place'], ['uturn', 'Sterling Place'], ['arrive', null]])
    expect(route.steps[1].crossing).toEqual({ at: 'Rogers Avenue', signals: true, first: true, light: true })
  })

  test('a new name straight on is no maneuver', () => {
    const route = walk([[0, 300], [0, 300]], [{ at: 0, type: 'depart', streetName: 'Rogers Avenue' }, { at: 300, modifier: 'straight', streetName: 'Bedford Avenue' }])
    expect(summary(route)).toEqual([['straight', 'Rogers Avenue'], ['arrive', null]])
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

  test('walking straight into a passage keeps the step', () => {
    const line = polyline([[0, 600]])
    const route = buildNavRoute([{
      mode: 'walking',
      geometry: line,
      instructions: [
        { type: 'depart', text: '', coordinate: line[0], distance: 300, duration: 200 },
        { type: 'continue', modifier: 'straight', text: '', coordinate: line[30], distance: 300, duration: 200 },
        { type: 'destination', text: '', coordinate: line[60], distance: 0, duration: 0 },
      ],
      edgeSegments: [
        { startDistance: 0, endDistance: 300, roadClass: 'footway' },
        { startDistance: 300, endDistance: 360, roadClass: 'footway', passage: 'arcade' },
        { startDistance: 360, endDistance: 600, roadClass: 'footway' },
      ],
    }])
    expect(summary(route)).toEqual([['straight', null], ['straight', null], ['arrive', null]])
  })
})
