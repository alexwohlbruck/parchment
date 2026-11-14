import { describe, test, expect } from 'bun:test'
import { pathMeters, routeSeconds, transitSeconds, withinReach } from './mode-estimates'
import type { TransitItinerary } from '../../types/integration.types'
import type { UnifiedRoute } from '../../types/unified-routing.types'

const route = (...durations: number[]) => ({
  routes: [{ legs: durations.map(duration => ({ duration })) }],
}) as unknown as UnifiedRoute

const itinerary = (duration: number, endTime: string, ...modes: string[]) => ({
  duration,
  endTime,
  legs: modes.map(mode => ({ mode })),
}) as unknown as TransitItinerary

describe('routeSeconds', () => {
  test('sums the legs of the first route', () => {
    expect(routeSeconds(route(600.4, 300))).toBe(900)
  })

  test('is null without a route', () => {
    expect(routeSeconds({ routes: [] } as unknown as UnifiedRoute)).toBeNull()
    expect(routeSeconds(null)).toBeNull()
    expect(routeSeconds(route())).toBeNull()
  })
})

describe('transitSeconds', () => {
  test('takes the earliest arrival, not the shortest ride', () => {
    const later = itinerary(900, '2026-11-13T10:40:00Z', 'WALK', 'BUS', 'WALK')
    const sooner = itinerary(1500, '2026-11-13T10:30:00Z', 'WALK', 'SUBWAY', 'WALK')
    expect(transitSeconds([later, sooner])).toBe(1500)
  })

  test('ignores itineraries that never board anything', () => {
    expect(transitSeconds([itinerary(1200, '2026-11-13T10:20:00Z', 'WALK')])).toBeNull()
    expect(transitSeconds([itinerary(1200, '2026-11-13T10:20:00Z', 'WALK', 'RENTAL')])).toBeNull()
    expect(transitSeconds(undefined)).toBeNull()
  })
})

describe('withinReach', () => {
  test('rules out walks and rides nobody would take', () => {
    expect(withinReach('walking', 5_000)).toBe(true)
    expect(withinReach('walking', 150_000)).toBe(false)
    expect(withinReach('biking', 400_000)).toBe(false)
    expect(withinReach('driving', 2_000_000)).toBe(true)
  })
})

describe('pathMeters', () => {
  test('adds up each hop', () => {
    const a = { lat: 0, lng: 0 }
    const b = { lat: 0, lng: 1 }
    expect(pathMeters([a, b, a])).toBeCloseTo(2 * pathMeters([a, b]), 3)
    expect(pathMeters([a])).toBe(0)
  })
})
