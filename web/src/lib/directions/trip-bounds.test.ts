import { describe, expect, it } from 'vitest'
import { boundsFillView, tripsBounds } from './trip-bounds'
import type { TripsResponse } from '@/types/directions.types'

const trips = {
  trips: [
    { id: 'a', segments: [{ geometry: [{ lat: 35.2, lng: -80.8 }, { lat: 35.3, lng: -80.7 }] }] },
    { id: 'b', segments: [{ geometry: [{ lat: 36, lng: -79 }] }] },
  ],
  request: { waypoints: [{ coordinate: { lat: 35.19, lng: -80.85 } }] },
} as unknown as TripsResponse

describe('tripsBounds', () => {
  it('covers only the visible trips and the waypoints', () => {
    expect(tripsBounds(trips, new Set(['a']))).toEqual({
      minLat: 35.19, minLng: -80.85, maxLat: 35.3, maxLng: -80.7,
    })
  })

  it('returns null when no trip is visible', () => {
    expect(tripsBounds(trips, new Set())).toBeNull()
  })
})

describe('boundsFillView', () => {
  const view = { north: 41, south: 40, east: -73, west: -74 }

  it('leaves a trip that already fills the view where it is', () => {
    expect(boundsFillView({ minLat: 40.2, maxLat: 40.9, minLng: -73.9, maxLng: -73.5 }, view)).toBe(true)
  })

  it('refits a trip that runs off the view', () => {
    expect(boundsFillView({ minLat: 40.2, maxLat: 41.2, minLng: -73.9, maxLng: -73.5 }, view)).toBe(false)
  })

  it('refits a trip too small to read at this zoom', () => {
    expect(boundsFillView({ minLat: 40.5, maxLat: 40.6, minLng: -73.6, maxLng: -73.5 }, view)).toBe(false)
  })
})
