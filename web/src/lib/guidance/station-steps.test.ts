import { describe, expect, test } from 'vitest'
import type { RouteEdgeSegment } from '@/types/directions.types'
import { buildNavRoute, type NavRoute, type NavSegmentInput } from './nav-route'
import { announcementText } from './phrases'
import { polyline, translator } from './test-routes'
import { richInstruction } from './instructions/rich-instruction'
import { bannerTitle, voiceText } from './instructions/instruction-text'
import { speechFor } from './instructions/rich-announcement'
import en from '@/lib/i18n/en-US.json'
import es from '@/lib/i18n/es-ES.json'

const t = translator(en)
const tEs = translator(es)

type Edge = Partial<RouteEdgeSegment>

/** 300 m walk north to a station, a 1 km ride north, then 300 m walk east. */
function trip(before: Edge[], after: Edge[]): NavRoute {
  const walkIn = polyline([[0, 300]])
  const ride = polyline([[0, 1000]], walkIn.at(-1)!)
  const walkOut = polyline([[90, 300]], ride.at(-1)!)
  const walking = (geometry: typeof walkIn, edges: Edge[], last: boolean): NavSegmentInput => ({
    mode: 'walking',
    geometry,
    instructions: [
      { type: 'depart', text: '', coordinate: geometry[0], distance: 300, duration: 220 },
      ...(last ? [{ type: 'destination', text: '', coordinate: geometry.at(-1)!, distance: 0, duration: 0 }] : []),
    ],
    edgeSegments: [{ startDistance: 0, endDistance: 300, roadClass: 'footway' }, ...edges].map(e => ({ startDistance: 0, endDistance: 0, ...e })),
  })
  return buildNavRoute([
    walking(walkIn, before, false),
    { mode: 'transit', geometry: ride, instructions: [{ type: 'board', text: '', coordinate: ride[0], distance: 0, duration: 0, streetName: 'Franklin Av' }] },
    walking(walkOut, after, true),
  ])
}

const speak = (route: NavRoute, index: number, translate = t) =>
  voiceText(richInstruction(route, route.steps[index], { from: route.steps[index].startDistance - 50, speed: 1.4 }), translate)

const words = (route: NavRoute) => route.steps.map((_, i) => speak(route, i))

describe('station entrances', () => {
  test('the walk in ends at the entrance and the walk out leaves by the exit', () => {
    const route = trip(
      [{ startDistance: 260, endDistance: 300, roadClass: 'footway', entrance: { ref: 'B', name: 'Bedford Av & Sterling Pl' } }],
      [{ startDistance: 40, endDistance: 300, roadClass: 'footway', entrance: { ref: 'A' } }],
    )
    expect(words(route)).toEqual([
      'Follow the path toward Franklin Av',
      'Enter the station at entrance B, Bedford Av & Sterling Pl',
      'Board at Franklin Av',
      'Follow the path',
      'Take exit A',
      'You have arrived',
    ])
    expect(route.steps[1].startDistance).toBeCloseTo(260, 0)
    expect(bannerTitle(richInstruction(route, route.steps[4], { from: 1300, speed: 1.4 }), t)).toBe('Take exit A')
    expect(speak(route, 1, tEs)).toBe('Entra en la estación por el acceso B, Bedford Av & Sterling Pl')
  })

  test('an entrance with only a name, or with nothing', () => {
    const route = trip(
      [{ startDistance: 260, endDistance: 300, roadClass: 'footway', entrance: { name: 'Bedford Av' } }],
      [{ startDistance: 40, endDistance: 300, roadClass: 'footway', entrance: {} }],
    )
    expect(speak(route, 1)).toBe('Enter the station at Bedford Av')
    expect(speak(route, 4)).toBe('Leave the station')
  })

  test('a step already at the entrance takes it on rather than doubling up', () => {
    const route = trip([], [{ startDistance: 0, endDistance: 300, roadClass: 'footway', entrance: { ref: 'S2', name: 'Fulton St' } }])
    expect(words(route).slice(2)).toEqual(['Take exit S2, Fulton St', 'You have arrived'])
  })

  test('the entrance places the prompt, so no distance is spoken with it', () => {
    const route = trip([{ startDistance: 260, endDistance: 300, roadClass: 'footway', entrance: { ref: 'B' } }], [])
    const announcement = { kind: 'maneuver' as const, phase: 'approach' as const, step: route.steps[1], distance: 60, then: null }
    const source = { route, from: 200, speed: 1.4, lanes: new Map(), home: false }
    expect(speechFor(announcement, source, true, false, t)).toBe('Enter the station at entrance B')
  })

  test('standard guidance names the step plainly', () => {
    const route = trip([{ startDistance: 260, endDistance: 300, roadClass: 'footway', entrance: { ref: 'B' } }], [])
    const announcement = { kind: 'maneuver' as const, phase: 'now' as const, step: route.steps[1], distance: 10, then: null }
    expect(announcementText(announcement, false, t)).toBe('Enter the station')
  })

  test('no entrance, no extra step', () => {
    expect(trip([], []).steps).toHaveLength(4)
  })
})

describe('climbs inside a station', () => {
  test('an escalator down to the platform and an elevator up to the street', () => {
    const route = trip(
      [
        { startDistance: 200, endDistance: 230, roadClass: 'footway', entrance: { ref: 'B' } },
        { startDistance: 230, endDistance: 250, roadClass: 'footway', level: '-1' },
        { startDistance: 250, endDistance: 270, roadClass: 'steps', conveying: true },
        { startDistance: 270, endDistance: 300, roadClass: 'footway', level: '-2' },
      ],
      [
        { startDistance: 0, endDistance: 50, roadClass: 'footway', level: '-2' },
        { startDistance: 50, endDistance: 55, roadClass: 'footway', elevator: true },
        { startDistance: 55, endDistance: 80, roadClass: 'footway', level: '0' },
        { startDistance: 80, endDistance: 300, roadClass: 'footway', entrance: { ref: 'A' } },
      ],
    )
    expect(words(route)).toEqual([
      'Follow the path toward Franklin Av',
      'Enter the station at entrance B',
      'Take the escalator down to the platform',
      'Board at Franklin Av',
      'Follow the path',
      'Take the elevator up to the street',
      'Take exit A',
      'You have arrived',
    ])
  })

  test('an escalator between numbered levels away from any station', () => {
    const line = polyline([[0, 200]])
    const route = buildNavRoute([{
      mode: 'walking',
      geometry: line,
      instructions: [
        { type: 'depart', text: '', coordinate: line[0], distance: 200, duration: 140 },
        { type: 'destination', text: '', coordinate: line.at(-1)!, distance: 0, duration: 0 },
      ],
      edgeSegments: [
        { startDistance: 0, endDistance: 100, roadClass: 'footway', level: '1' },
        { startDistance: 100, endDistance: 115, roadClass: 'steps', conveying: true },
        { startDistance: 115, endDistance: 200, roadClass: 'footway', level: '2' },
      ],
    }])
    expect(words(route)).toEqual(['Follow the path', 'Take the escalator up to level 2', 'You have arrived'])
    expect(speak(route, 1, tEs)).toBe('Sube por la escalera mecánica hasta la planta 2')
  })

  test('outdoor stairs straight on are not a step of their own', () => {
    const route = trip([{ startDistance: 100, endDistance: 110, roadClass: 'steps' }], [])
    expect(route.steps).toHaveLength(4)
  })

  test('changing trains, the last climb reaches the next platform', () => {
    const first = polyline([[0, 500]])
    const transfer = polyline([[90, 120]], first.at(-1)!)
    const second = polyline([[0, 500]], transfer.at(-1)!)
    const ride = (geometry: typeof first): NavSegmentInput => ({
      mode: 'transit',
      geometry,
      instructions: [{ type: 'board', text: '', coordinate: geometry[0], distance: 0, duration: 0 }],
    })
    const route = buildNavRoute([
      ride(first),
      {
        mode: 'walking',
        geometry: transfer,
        instructions: [{ type: 'depart', text: '', coordinate: transfer[0], distance: 120, duration: 90 }],
        edgeSegments: [
          { startDistance: 0, endDistance: 60, roadClass: 'footway', level: '-1' },
          { startDistance: 60, endDistance: 75, roadClass: 'steps', conveying: true },
          { startDistance: 75, endDistance: 120, roadClass: 'footway', level: '-2' },
        ],
      },
      { ...ride(second), instructions: [...ride(second).instructions!, { type: 'destination', text: '', coordinate: second.at(-1)!, distance: 0, duration: 0 }] },
    ])
    expect(words(route)).toEqual(['Board', 'Follow the path', 'Take the escalator down to the platform', 'Board', 'You have arrived'])
  })
})
