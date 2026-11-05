import { describe, expect, it } from 'vitest'
import type { GuidanceStep, StationWalk, TransitTransfer } from '@server/types/station-guidance.types'
import type { GuidedSegment } from '@/lib/transit/station/station-walks'
import type { TransitStage } from './transit-progress'
import {
  advanceGuide,
  autoAdvance,
  guideView,
  startGuide,
  stationGuideTarget,
  STREET_RESUME_METERS,
} from './station-guide'

const step = (instruction: string, duration: number): GuidanceStep => ({
  type: 'walk', instruction, distance: duration, duration, fromLevel: -1, toLevel: -1,
  levelChange: null, landmark: null, bridged: false, fromVertex: 0, toVertex: 1,
})

const end = { id: 'p', kind: 'platform' as const, name: null, lat: 0, lng: 0, level: -1 }
const walk = (steps: GuidanceStep[], estimate = false): StationWalk => ({
  source: estimate ? 'estimated' : 'graph', estimate, seconds: 82, uncertaintyS: 10, metres: 90, levels: 1,
  from: end, to: end, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, steps,
})
const transfer = (w: StationWalk): TransitTransfer => ({
  class: 'in_station', surfaces: false, reentryFree: null, fareGateDelayS: 0, seconds: 82, source: 'graph', walk: w,
})
const access = (w: StationWalk) => ({
  id: 'e', name: null, ref: null, cornerLabel: null, lat: 0, lng: 0, streetSeconds: 0, stationSeconds: 0, totalSeconds: 0, walk: w,
})

const changeWalk = walk([step('Follow signs for the 7', 30), step('Take the stairs down', 10), step('Board the 7', 0)])
const trip: GuidedSegment[] = [
  { mode: 'walking' },
  { mode: 'transit', entrance: access(walk([step('Go through the fare gates', 10)])) },
  { mode: 'walking' },
  { mode: 'transit', transfer: transfer(changeWalk), exit: access(walk([step('Take exit 2', 20)])) },
  { mode: 'walking' },
]
const waiting = (segmentIndex: number, kind: 'to-stop' | 'wait'): TransitStage => ({ segmentIndex, kind, stop: 'Times Sq', departureMs: 0 })

describe('stationGuideTarget', () => {
  it('guides a change between rides as soon as the rider heads for the next one', () => {
    expect(stationGuideTarget(trip, waiting(3, 'to-stop'), { index: 2, into: 5 })?.key).toBe('transfer:3')
  })

  it('guides from the entrance once the rider is at the station', () => {
    expect(stationGuideTarget(trip, waiting(1, 'to-stop'), { index: 0, into: 100 })).toBeNull()
    expect(stationGuideTarget(trip, waiting(1, 'wait'), { index: 0, into: 300 })?.kind).toBe('access')
  })

  it('guides out to the street until GPS sees the rider walking away', () => {
    expect(stationGuideTarget(trip, null, { index: 4, into: 0 })?.key).toBe('egress:3')
    expect(stationGuideTarget(trip, null, { index: 4, into: STREET_RESUME_METERS })).toBeNull()
  })

  it('never narrates an estimate', () => {
    const guessed: GuidedSegment[] = [{ mode: 'transit' }, { mode: 'transit', transfer: transfer(walk([step('x', 5)], true)) }]
    expect(stationGuideTarget(guessed, waiting(1, 'wait'), null)).toBeNull()
  })
})

describe('stepping through a station', () => {
  const guide = stationGuideTarget(trip, waiting(3, 'wait'), null)!

  it('moves on by hand and finishes after the last step', () => {
    let state = startGuide(guide, 0)
    state = advanceGuide(state, guide, 1000)!
    expect(guideView(state, guide, 1000)).toMatchObject({ index: 1, total: 3, next: { instruction: 'Board the 7' } })
    state = advanceGuide(state, guide, 2000)!
    expect(advanceGuide(state, guide, 3000)).toBeNull()
  })

  it('moves on by itself once a step has had half again its time, holding at the last', () => {
    const state = startGuide(guide, 0)
    expect(guideView(state, guide, 0).advancesInMs).toBe(45_000)
    expect(autoAdvance(state, guide, 44_000).step).toBe(0)
    expect(autoAdvance(state, guide, 45_000).step).toBe(1)
    const held = autoAdvance(state, guide, 600_000)
    expect(held.step).toBe(2)
    expect(guideView(held, guide, 600_000).advancesInMs).toBeNull()
  })
})
