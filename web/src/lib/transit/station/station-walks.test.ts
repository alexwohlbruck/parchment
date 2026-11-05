import { describe, expect, it } from 'vitest'
import type { StationAccessChoice, StationWalk, TransitTransfer } from '@server/types/station-guidance.types'
import {
  levelRuns,
  replacedTransferWalks,
  stationWalkFeatures,
  stationWalksAt,
  transferAt,
  type GuidedSegment,
} from './station-walks'

const end = (level: number | null) => ({ id: 'x', kind: 'platform' as const, name: null, lat: 0, lng: 0, level })

const walk = (over: Partial<StationWalk> = {}): StationWalk => ({
  source: 'graph', estimate: false, seconds: 82, uncertaintyS: 10, metres: 90, levels: 1,
  from: end(-1), to: end(-2),
  geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  vertexLevels: [-1, -1, -2, -2],
  ...over,
})

const access = (w: StationWalk): StationAccessChoice => ({
  id: 'e', name: null, ref: null, cornerLabel: 'A & B · NW corner', lat: 0, lng: 0,
  streetSeconds: 60, stationSeconds: w.seconds, totalSeconds: 60 + w.seconds, walk: w,
})

const transfer = (w: StationWalk | null): TransitTransfer => ({
  class: 'in_station', surfaces: false, reentryFree: null, fareGateDelayS: 0, seconds: 82, source: 'graph', walk: w,
})

const enter = walk({ seconds: 40 })
const change = walk()
const leave = walk({ seconds: 50 })

const trip: GuidedSegment[] = [
  { mode: 'walking' },
  { mode: 'transit', entrance: access(enter) },
  { mode: 'walking' },
  { mode: 'transit', transfer: transfer(change), exit: access(leave) },
  { mode: 'walking' },
]

describe('stationWalksAt', () => {
  it('puts the entrance walk with the walk to the station and the exit walk with the walk away', () => {
    expect(stationWalksAt(trip, 0).map(w => w.walk)).toEqual([enter])
    expect(stationWalksAt(trip, 4).map(w => w.walk)).toEqual([leave])
  })

  it('puts the change between rides with the walk between them', () => {
    expect(stationWalksAt(trip, 2)).toEqual([{ kind: 'transfer', walk: change, ride: 3 }])
    expect(transferAt(trip, 2)?.walk).toBe(change)
  })

  it('puts a change with no walk segment on the ride it boards', () => {
    const direct: GuidedSegment[] = [{ mode: 'transit' }, { mode: 'transit', transfer: transfer(change) }]
    expect(stationWalksAt(direct, 1).map(w => w.kind)).toEqual(['transfer'])
    expect(transferAt(direct, 1)?.class).toBe('in_station')
    expect(transferAt(direct, 0)).toBeNull()
  })

  it('says nothing about a change to or from a bus', () => {
    const bus: GuidedSegment[] = [{ mode: 'transit', routeType: 'bus' }, { mode: 'walking' }, { mode: 'transit', routeType: 'subway', transfer: transfer(null) }]
    expect(transferAt(bus, 1)).toBeNull()
  })
})

describe('station walk drawing', () => {
  it('splits a walk where it changes level, sharing the joining vertex', () => {
    expect(levelRuns(change)).toEqual([
      { level: -1, coordinates: [[0, 0], [1, 0], [2, 0]] },
      { level: -2, coordinates: [[2, 0], [3, 0]] },
    ])
  })

  it('draws walked paths and never an estimate', () => {
    const guessed: GuidedSegment[] = [
      { mode: 'transit' },
      { mode: 'walking' },
      { mode: 'transit', transfer: transfer(walk({ estimate: true, source: 'estimated' })) },
    ]
    expect(stationWalkFeatures(guessed).features).toEqual([])
    expect(replacedTransferWalks(guessed).size).toBe(0)
    expect(stationWalkFeatures(trip).features.map(f => f.properties.kind)).toEqual([
      'access', 'access', 'transfer', 'transfer', 'egress', 'egress',
    ])
    expect([...replacedTransferWalks(trip)]).toEqual([2])
  })
})
