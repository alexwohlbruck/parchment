import { describe, expect, test } from 'vitest'
import type { RouteEdgeSegment, RouteHazardKind, RouteInstruction } from '@/types/directions.types'
import type { LaneArrow, LanePlan } from '../lanes'
import { buildNavRoute, type NavRoute, type NavSegmentInput } from '../nav-route'
import { polyline, translator } from '../test-routes'
import { chained, departure, richInstruction, type InstructionContext } from './rich-instruction'
import { bannerCue, voiceText } from './instruction-text'
import en from '@/lib/i18n/en-US.json'
import es from '@/lib/i18n/es-ES.json'

const t = translator(en)
const tEs = translator(es)

/** 600 m north on Tryon, right onto Trade, 400 m east, left onto College, 500 m north. */
const geometry = polyline([
  [0, 600],
  [90, 400],
  [0, 500],
])

type Step = Partial<RouteInstruction>

interface CityOptions {
  hazards?: [RouteHazardKind, number][]
  edges?: Partial<RouteEdgeSegment>[]
  right?: Step
  left?: Step
  mode?: string
}

function city({ hazards = [], edges = [], right = {}, left = {}, mode = 'driving' }: CityOptions = {}): NavRoute {
  const input: NavSegmentInput = {
    mode,
    geometry,
    instructions: [
      { type: 'depart', text: '', coordinate: geometry[0], distance: 600, duration: 60, streetName: 'Tryon Street' },
      { type: 'turn', modifier: 'right', text: '', coordinate: geometry[60], distance: 400, duration: 40, streetName: 'Trade Street', ...right },
      { type: 'turn', modifier: 'left', text: '', coordinate: geometry[100], distance: 500, duration: 50, streetName: 'College Street', ...left },
      { type: 'destination', text: '', coordinate: geometry[150], distance: 0, duration: 0 },
    ],
    hazards: hazards.map(([kind, s]) => ({ kind, severity: 'low' as const, startDistance: s, coordinate: geometry[0] })),
    edgeSegments: edges.map(e => ({ startDistance: 0, endDistance: 0, ...e })),
  }
  return buildNavRoute([input])
}

const turnRight = (route: NavRoute, context: Partial<InstructionContext> = {}) =>
  richInstruction(route, route.steps[1], { from: 300, speed: 12, ...context })

const plan = (...lanes: [LaneArrow[], boolean][]): LanePlan => ({
  lanes: lanes.map(([arrows, valid]) => ({ arrows, valid, recommended: false })),
})

describe('landmark anchors', () => {
  test('a light at the turn', () => {
    expect(voiceText(turnRight(city({ hazards: [['traffic_signals', 596]] })), t)).toBe('At the light, turn right onto Trade Street')
  })

  test('counts lights from the traveller', () => {
    const route = city({ hazards: [['traffic_signals', 420], ['traffic_signals', 596]] })
    expect(voiceText(turnRight(route), t)).toBe('At the second light, turn right onto Trade Street')
    expect(voiceText(turnRight(route, { from: 450 }), t)).toBe('At the light, turn right onto Trade Street')
  })

  test('a light just before the turn', () => {
    expect(voiceText(turnRight(city({ hazards: [['traffic_signals', 530]] })), t)).toBe('After the light, turn right onto Trade Street')
  })

  test('never names one of two lights close together', () => {
    expect(turnRight(city({ hazards: [['traffic_signals', 565], ['traffic_signals', 596]] })).anchor).toBeUndefined()
    const uncountable = city({ hazards: [['traffic_signals', 400], ['traffic_signals', 430], ['traffic_signals', 596]] })
    expect(turnRight(uncountable).anchor?.kind).not.toBe('traffic_signals')
  })

  test('stop and yield signs', () => {
    expect(voiceText(turnRight(city({ hazards: [['stop', 598]] })), t)).toBe('At the stop sign, turn right onto Trade Street')
    expect(voiceText(turnRight(city({ hazards: [['give_way', 540]] })), t)).toBe('After the yield sign, turn right onto Trade Street')
  })

  test('walkers are not told about stop signs', () => {
    expect(turnRight(city({ mode: 'walking', hazards: [['stop', 598]] }), { speed: 1.4 }).anchor).toBeUndefined()
  })

  test('a bridge that ends just before the turn', () => {
    const route = city({ edges: [{ startDistance: 400, endDistance: 540, roadEnvironment: 'bridge' }] })
    expect(voiceText(turnRight(route), t)).toBe('After the bridge, turn right onto Trade Street')
  })

  test('the intersection just ahead, when the turn is past it', () => {
    const route = city({ hazards: [['traffic_signals', 470]] })
    expect(voiceText(turnRight(route, { from: 420 }), t)).toBe('Go past this intersection, then turn right onto Trade Street')
  })

  test('prefers the light the turn is at over a bridge before it', () => {
    const route = city({ hazards: [['traffic_signals', 596]], edges: [{ startDistance: 400, endDistance: 540, roadEnvironment: 'bridge' }] })
    expect(turnRight(route).anchor).toMatchObject({ kind: 'traffic_signals', relation: 'at' })
  })
})

describe('road shape', () => {
  test('a fork', () => {
    const route = city({ right: { type: 'continue', modifier: 'slight-right' } })
    expect(voiceText(turnRight(route), t)).toBe('At the fork, bear right onto Trade Street')
  })

  test('the end of the road, where no lane goes straight on', () => {
    const route = city()
    const lanes = plan([['left'], false], [['right'], true])
    expect(voiceText(turnRight(route, { lanes }), t, { lanes: false })).toBe('At the end of the road, turn right onto Trade Street')
  })

  test('straight on to stay on the same road', () => {
    const route = city({ right: { type: 'continue', modifier: 'straight', streetName: 'Tryon Street' } })
    expect(voiceText(turnRight(route), t)).toBe('Continue straight to stay on Tryon Street')
  })
})

describe('lanes', () => {
  test('one lane, counted from the nearer edge', () => {
    const lanes = plan([['through'], false], [['through'], false], [['right'], true], [['right', 'through'], false])
    expect(voiceText(turnRight(city(), { lanes }), t)).toBe('Use the second lane from the right to turn right onto Trade Street')
  })

  test('a pair of lanes on one side', () => {
    const lanes = plan([['through', 'right'], true], [['right'], true], [['through'], false])
    expect(voiceText(turnRight(city(), { lanes }), t)).toBe('Use either of the two left lanes to turn right onto Trade Street')
  })

  test('the middle lane', () => {
    const lanes = plan([['left'], false], [['through', 'right'], true], [['right', 'through'], false])
    expect(voiceText(turnRight(city(), { lanes }), t)).toBe('Use the middle lane to turn right onto Trade Street')
  })
})

describe('signs and exits', () => {
  test('a numbered exit toward its destination', () => {
    const route = city({ right: { type: 'continue', modifier: 'slight-right', exitRef: '12', destination: 'Brooklyn', streetName: undefined } })
    const instruction = turnRight(route)
    expect(voiceText(instruction, t)).toBe('Take exit 12 toward Brooklyn')
    expect(bannerCue(instruction, t)).toBe('Exit 12 · Brooklyn')
  })

  test('an unnumbered exit off a motorway', () => {
    const route = city({
      right: { type: 'continue', modifier: 'slight-right', streetName: undefined },
      edges: [{ startDistance: 0, endDistance: 600, roadClass: 'motorway' }, { startDistance: 600, endDistance: 1000, roadClass: 'motorway_link' }],
    })
    expect(voiceText(turnRight(route), t)).toBe('Take the exit on the right')
  })

  test('keeping to one side, following the signs', () => {
    const route = city({ right: { type: 'continue', modifier: 'slight-right', destination: 'Downtown' } })
    expect(voiceText(turnRight(route), t)).toBe('Keep right, following signs for Downtown')
  })
})

describe('chained maneuvers', () => {
  test('a second turn right after the first', () => {
    const route = city()
    const first = richInstruction(route, route.steps[1], { from: 580, speed: 12 })
    const next = richInstruction(route, route.steps[2], { from: 600, speed: 12 })
    expect(voiceText(chained(first, next, 30, 12), t)).toBe('Turn right onto Trade Street, then immediately turn left onto College Street')
    expect(voiceText(chained(first, next, 300, 12), t)).toBe('Turn right onto Trade Street, then turn left onto College Street')
  })

  test('a keep straight after a turn', () => {
    const route = city({ left: { type: 'continue', modifier: 'slight-left', streetName: 'Trade Street' } })
    const first = richInstruction(route, route.steps[1], { from: 580, speed: 12 })
    const next = richInstruction(route, route.steps[2], { from: 600, speed: 12 })
    expect(voiceText(chained(first, next, 30, 12), t)).toBe('After turning right, keep left to stay on Trade Street')
  })
})

describe('roundabouts', () => {
  function roundabout(legs: [number, number][], exitNumber: number) {
    const points = polyline(legs)
    return buildNavRoute([{
      mode: 'driving',
      geometry: points,
      instructions: [
        { type: 'depart', text: '', coordinate: points[0], distance: 300, duration: 30 },
        { type: 'roundabout', text: '', coordinate: points[30], distance: 40, duration: 8, exitNumber, streetName: 'Main Street' },
        { type: 'destination', text: '', coordinate: points.at(-1)!, distance: 0, duration: 0 },
      ],
    }])
  }

  test('the exit to take, by its ordinal', () => {
    const route = roundabout([[0, 300], [45, 20], [90, 20], [90, 300]], 3)
    const instruction = richInstruction(route, route.steps[1], { from: 100, speed: 10 })
    expect(voiceText(instruction, t)).toBe('Enter the roundabout and take the third exit onto Main Street')
    expect(voiceText(instruction, tEs)).toBe('Entra en la rotonda y toma la tercera salida hacia Main Street')
  })

  test('straight through', () => {
    const route = roundabout([[0, 300], [40, 20], [-40, 20], [0, 300]], 2)
    expect(voiceText(richInstruction(route, route.steps[1], { from: 100, speed: 10 }), t)).toBe('Continue straight through the roundabout')
  })
})

describe('arrival', () => {
  const route = city()
  const arrive = (context: Partial<InstructionContext>) => richInstruction(route, route.steps[3], { from: 1400, speed: 10, ...context })

  test('the side the destination is on', () => {
    expect(voiceText(arrive({ destinationSide: 'left' }), t)).toBe('You have arrived. Your destination is on the left')
  })

  test('welcomes the traveller home', () => {
    expect(voiceText(arrive({ home: true, destinationSide: 'right' }), t)).toBe('Welcome home. Your destination is on the right')
    expect(voiceText(arrive({ home: true }), tEs)).toBe('Bienvenido a casa')
  })
})

describe('on foot', () => {
  const walk = (options: CityOptions) => city({ mode: 'walking', ...options })
  const step = (route: NavRoute) => richInstruction(route, route.steps[1], { from: 560, speed: 1.4 })

  test('stairs on the side of the turn', () => {
    const route = walk({ right: { streetName: undefined }, edges: [{ startDistance: 600, endDistance: 640, roadClass: 'steps' }] })
    expect(voiceText(step(route), t)).toBe('Take the stairs on your right')
  })

  test('a pedestrian bridge', () => {
    const route = walk({ right: { streetName: undefined }, edges: [{ startDistance: 600, endDistance: 700, roadClass: 'footway', roadEnvironment: 'bridge' }] })
    expect(voiceText(step(route), t)).toBe('Use the pedestrian bridge')
  })

  test('a crossing, at the light where it has one', () => {
    const route = walk({ right: { streetName: undefined }, edges: [{ startDistance: 605, endDistance: 620, roadClass: 'footway', crossing: 'TRAFFIC_SIGNALS' }] })
    expect(voiceText(step(route), t)).toBe('Cross at the light')
    expect(voiceText(step(route), tEs)).toBe('Cruza en el semáforo')
  })

  test('an unnamed path straight ahead', () => {
    const route = walk({ right: { type: 'continue', modifier: 'straight', streetName: undefined }, edges: [{ startDistance: 600, endDistance: 1000, roadClass: 'footway' }] })
    expect(voiceText(step(route), t)).toBe('Follow the path')
  })

  test('sets off along the road', () => {
    const route = walk({})
    expect(voiceText(departure(route, route.steps[0]), t)).toBe('Head north along Tryon Street')
    expect(voiceText(departure(route, route.steps[0]), tEs)).toBe('Ve hacia el norte por Tryon Street')
  })
})

describe('Spanish', () => {
  test('counts lights with masculine ordinals and lanes with their own', () => {
    const route = city({ hazards: [['traffic_signals', 420], ['traffic_signals', 596]] })
    const lanes = plan([['through'], false], [['through'], false], [['right'], true], [['right', 'through'], false])
    expect(voiceText(turnRight(route, { lanes }), tEs)).toBe('En el segundo semáforo, usa el segundo carril por la derecha para girar a la derecha hacia Trade Street')
  })
})
