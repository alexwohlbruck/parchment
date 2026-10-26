import { describe, expect, test } from 'vitest'
import { distanceMeters } from '@/lib/map/movement-interpolation'
import { adoptItinerary, rerouteOrigin, spliceReroute, splitAtStop } from './reroute'
import type { NavSegmentInput } from './nav-route'

describe('rerouteOrigin', () => {
  test('leads the traveller by a few seconds of travel', () => {
    const at = { lat: 40.7, lng: -73.99 }
    expect(distanceMeters(at, rerouteOrigin(at, 90, 10))).toBeCloseTo(80, 0)
  })

  test('stays put when stopped or heading is unknown', () => {
    const at = { lat: 40.7, lng: -73.99 }
    expect(rerouteOrigin(at, null, 10)).toEqual(at)
    expect(rerouteOrigin(at, 90, 0.2)).toEqual(at)
  })
})

describe('spliceReroute', () => {
  const leg: NavSegmentInput[] = [
    { mode: 'walking', geometry: [] },
    { mode: 'driving', geometry: [] },
    { mode: 'walking', geometry: [] },
  ]

  test('replaces the current segment and keeps those after it', () => {
    const fresh = { geometry: [{ lat: 1, lng: 1 }] }
    const result = spliceReroute(leg, 1, fresh)
    expect(result.map(s => s.mode)).toEqual(['driving', 'walking'])
    expect(result[0].geometry).toEqual(fresh.geometry)
  })

  test('drops the lanes drawn from the replaced geometry', () => {
    const laned: NavSegmentInput[] = [{ mode: 'driving', geometry: [], laneGeometry: { coordinates: [], measures: [] }, lanePlan: [] }]
    const result = spliceReroute(laned, 0, { geometry: [{ lat: 1, lng: 1 }] })
    expect(result[0].laneGeometry).toBeUndefined()
    expect(result[0].lanePlan).toBeUndefined()
  })
})

describe('splitAtStop', () => {
  const segments: (NavSegmentInput & { end?: { label?: string } })[] = [
    { mode: 'driving', end: { label: 'Home' } },
    { mode: 'walking', end: { label: 'Door' } },
  ]
  const stop = { label: 'Cafe', location: { lat: 1, lng: 2 } }

  test('ends this leg at the stop and carries the rest on', () => {
    const split = splitAtStop(segments, 0, { geometry: [] }, { geometry: [stop.location] }, stop)
    expect(split?.leg).toEqual([{ mode: 'driving', geometry: [], end: { label: 'Cafe', location: stop.location } }])
    expect(split?.continuation).toEqual([
      { mode: 'driving', end: { label: 'Home' }, geometry: [stop.location] },
      { mode: 'walking', end: { label: 'Door' } },
    ])
  })
})

describe('adoptItinerary', () => {
  test('takes the leg index of the segment replaced and ends where the leg did', () => {
    const line = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }]
    type Seg = { mode: string; geometry: typeof line; legIndex: number; end?: { label: string } }
    const old: Seg[] = [
      { mode: 'walking', geometry: line, legIndex: 2 },
      { mode: 'transit', geometry: line, legIndex: 2, end: { label: 'Home' } },
    ]
    const fresh: Seg[] = [{ mode: 'walking', geometry: line, legIndex: 0 }, { mode: 'transit', geometry: line, legIndex: 0 }]
    const leg = adoptItinerary(old, 0, fresh)
    expect(leg.map(s => s.legIndex)).toEqual([2, 2])
    expect(leg[1].end).toEqual({ label: 'Home' })
    expect(leg[0].end).toBeUndefined()
  })
})
