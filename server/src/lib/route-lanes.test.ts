import { describe, expect, test } from 'bun:test'
import { applyLanes, drivingSideFor, laneArrows, lanesRequest, segmentCountry, type LanedSegment } from './route-lanes'
import { attachLanes } from '../services/route-lanes.service'
import type { Coordinate, RouteInstruction, RouteLanes } from '../types/unified-routing.types'

/** 200 m east, then 200 m south, as two ways with a right turn between. */
function drive(edges = [{ osmWayId: 1 }, { osmWayId: 2 }]): LanedSegment {
  const geometry: Coordinate[] = [
    { lat: 40.75, lng: -73.99 },
    { lat: 40.75, lng: -73.98763 },
    { lat: 40.74820, lng: -73.98763 },
  ]
  const instruction = (i: number, type: string, modifier?: string): RouteInstruction =>
    ({ type, modifier, coordinate: geometry[i], text: '', distance: 0, duration: 0 }) as RouteInstruction
  return {
    mode: 'driving',
    geometry,
    instructions: [instruction(0, 'continue', 'straight'), instruction(1, 'turn', 'right'), instruction(2, 'destination')],
    edgeSegments: edges.map((e, i) => ({ startDistance: i * 200, endDistance: i * 200 + 200, country: 'USA', ...e })),
  }
}

const answer: RouteLanes = {
  drivingSide: 'right',
  lanePlan: [{ maneuver: 1, lanes: [
    { turns: ['left'], valid: false, recommended: false },
    { turns: [], valid: false, recommended: false },
    { turns: ['through', 'right'], valid: true, recommended: true },
  ] }],
  laneGeometry: { coordinates: [[-73.99, 40.74997], [-73.98766, 40.7482]], measures: [0, 400] },
}

describe('lanesRequest', () => {
  test('sends the ways, and each maneuver at its vertex with its turn', () => {
    const request = lanesRequest(drive())!
    expect(request.ways).toEqual([{ from: 0, to: 200, osmWayId: 1 }, { from: 200, to: 400, osmWayId: 2 }])
    expect(request.coordinates[1]).toEqual([-73.98763, 40.75])
    expect(request.maneuvers.map(m => m.turn)).toEqual(['through', 'right', undefined])
    expect(request.maneuvers[1].distance).toBeCloseTo(200, -1)
    expect(request.country).toBe('USA')
    expect(request.profile).toBe('car')
  })

  test('asks for a bike line for a ride, whichever name the mode goes by', () => {
    expect(lanesRequest({ ...drive(), mode: 'biking' })?.profile).toBe('bike')
    expect(lanesRequest({ ...drive(), mode: 'cycling' })?.profile).toBe('bike')
  })

  test('asks nothing of a graph without way ids, or a segment not driven', () => {
    expect(lanesRequest(drive([{ osmWayId: undefined as never }]))).toBeNull()
    expect(lanesRequest({ ...drive(), mode: 'walking' })).toBeNull()
  })
})

describe('applyLanes', () => {
  test('puts the plan on its instruction, as lane strip arrows', () => {
    const segment = drive()
    applyLanes(segment, answer)
    expect(segment.lanePlan).toEqual([{ instruction: 1, lanes: [
      { arrows: ['left'], valid: false, recommended: false },
      { arrows: ['through'], valid: false, recommended: false },
      { arrows: ['through', 'right'], valid: true, recommended: true },
    ] }])
    expect(segment.laneGeometry?.measures).toEqual([0, 400])
  })

  test('keeps lane plans to driving', () => {
    const ride = { ...drive(), mode: 'biking' }
    applyLanes(ride, answer)
    expect(ride.laneGeometry).toBeDefined()
    expect(ride.lanePlan).toBeUndefined()
  })

  test('maps turn:lanes values to arrows', () => {
    expect(laneArrows(['sharp_left', 'left'])).toEqual(['left'])
    expect(laneArrows(['reverse'])).toEqual(['uturn'])
    expect(laneArrows(['merge_to_right'])).toEqual(['through'])
  })
})

describe('driving side', () => {
  test('reads the country most of the segment is in', () => {
    expect(segmentCountry([
      { startDistance: 0, endDistance: 10, country: 'FRA' },
      { startDistance: 10, endDistance: 500, country: 'GBR' },
    ])).toBe('GBR')
    expect(drivingSideFor('GBR')).toBe('left')
    expect(drivingSideFor('USA')).toBe('right')
    expect(drivingSideFor(undefined)).toBe('right')
  })
})

describe('attachLanes', () => {
  test('attaches lanes to driven and ridden segments only, and survives a failure', async () => {
    const driven = drive()
    const ridden = { ...drive(), mode: 'biking' }
    const walked = { ...drive(), mode: 'walking' }
    const failing = drive()
    let calls = 0
    await attachLanes([driven, ridden, walked], async () => (calls++, answer))
    await attachLanes([failing], async () => { throw new Error('down') })
    expect(calls).toBe(2)
    expect(driven.laneGeometry).toBeDefined()
    expect(ridden.laneGeometry).toBeDefined()
    expect(walked.laneGeometry).toBeUndefined()
    expect(failing.drivingSide).toBe('right')
    expect(failing.laneGeometry).toBeUndefined()
  })
})
