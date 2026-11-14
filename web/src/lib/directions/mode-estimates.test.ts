import { describe, expect, it } from 'vitest'
import {
  modesToEstimate,
  plannedSeconds,
  travelTimeFor,
  travelTimesKey,
  withTravelTimes,
  type TravelTimes,
} from './mode-estimates'

const trip = (totalDuration: number, isRecommended?: boolean) =>
  ({ summary: { totalDuration }, isRecommended }) as Parameters<typeof plannedSeconds>[0][number]

describe('travelTimesKey', () => {
  const a = { lat: 40.75361, lng: -73.98321 }
  const b = { lat: 40.6782, lng: -73.9442 }

  it('absorbs a few metres of location jitter', () => {
    const nudged = { lat: 40.75362, lng: -73.98322 }
    expect(travelTimesKey([nudged, b], null, {})).toBe(travelTimesKey([a, b], null, {}))
  })

  it('tells apart stop order, departure and preferences', () => {
    const key = travelTimesKey([a, b], null, {})
    expect(travelTimesKey([b, a], null, {})).not.toBe(key)
    expect(travelTimesKey([a, b], '2026-11-14T09:00:00Z', {})).not.toBe(key)
    expect(travelTimesKey([a, b], null, { walking: { walkingSpeed: 6 } })).not.toBe(key)
  })
})

describe('plannedSeconds', () => {
  it('leads with the recommended trip', () => {
    expect(plannedSeconds([trip(900), trip(1200, true)])).toBe(1200)
  })

  it('falls back to the first trip, and to null when there are none', () => {
    expect(plannedSeconds([trip(900), trip(600)])).toBe(900)
    expect(plannedSeconds([])).toBeNull()
  })
})

describe('travelTimeFor', () => {
  it('prefers a planned time over an estimate', () => {
    expect(travelTimeFor('driving', { driving: 700 }, { driving: 600 }, false)).toEqual({ state: 'ready', seconds: 700 })
  })

  it('reports a mode with no route, even from a plan that found nothing', () => {
    expect(travelTimeFor('transit', { transit: null }, { transit: 1500 }, false)).toEqual({ state: 'none' })
    expect(travelTimeFor('walking', undefined, { walking: null }, false)).toEqual({ state: 'none' })
  })

  it('shows loading only while an answer is on its way', () => {
    expect(travelTimeFor('biking', undefined, undefined, true)).toEqual({ state: 'loading' })
    expect(travelTimeFor('biking', undefined, undefined, false)).toEqual({ state: 'unknown' })
  })
})

describe('modesToEstimate', () => {
  it('skips the mode being planned and any mode already known', () => {
    expect(modesToEstimate('transit', { multi: 800 }, { walking: null })).toEqual(['biking', 'driving'])
  })

  it('asks for every street and transit mode from the all-modes tab', () => {
    expect(modesToEstimate('multi', undefined, undefined)).toEqual(['walking', 'biking', 'driving', 'transit'])
  })
})

describe('withTravelTimes', () => {
  it('merges into an existing entry without touching the original map', () => {
    const before = new Map([['k', { walking: 100 }]])
    const after = withTravelTimes(before, 'k', { biking: 50 })
    expect(after.get('k')).toEqual({ walking: 100, biking: 50 })
    expect(before.get('k')).toEqual({ walking: 100 })
  })

  it('drops the least recently written entry past the cap', () => {
    let map = new Map<string, TravelTimes>()
    map = withTravelTimes(map, 'a', { walking: 1 }, 2)
    map = withTravelTimes(map, 'b', { walking: 2 }, 2)
    map = withTravelTimes(map, 'a', { walking: 3 }, 2)
    map = withTravelTimes(map, 'c', { walking: 4 }, 2)
    expect([...map.keys()]).toEqual(['a', 'c'])
  })
})
