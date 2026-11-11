import { describe, expect, it } from 'vitest'
import { tripsBounds } from './trip-bounds'
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
