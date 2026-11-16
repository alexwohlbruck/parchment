import { describe, it, expect } from 'vitest'
import { endpointPlace, proposedTrip } from './ask-trip'
import type { TripOption } from '@/types/directions.types'

const trip = (id: string, rank: number, segments: object[]) => ({ id, rank, segments }) as unknown as TripOption

describe('proposedTrip', () => {
  const ride = trip('ride', 2, [{ mode: 'cycling', duration: 300 }])
  const share = trip('share', 3, [
    { mode: 'walking', duration: 180 },
    { mode: 'cycling', duration: 360, sharedMobilityDetails: { vehicleType: 'bike' } },
  ])
  const subway = trip('subway', 1, [{ mode: 'transit', duration: 900 }])

  it('takes the best-ranked trip of the kind Ask proposed', () => {
    expect(proposedTrip([ride, share, subway], 'bikeshare')?.id).toBe('share')
    expect(proposedTrip([ride, share, subway], 'biking')?.id).toBe('ride')
  })

  it('shows the trip riding the lines Ask described, else plain transit before mixes', () => {
    const bikeTo5 = trip('bike-5', 1, [
      { mode: 'cycling', duration: 200 },
      { mode: 'transit', duration: 700, lineName: '5' },
    ])
    const walkTo4 = trip('walk-4', 2, [
      { mode: 'walking', duration: 200 },
      { mode: 'transit', duration: 800, lineName: '4' },
    ])
    const walkTo5 = trip('walk-5', 3, [
      { mode: 'walking', duration: 300 },
      { mode: 'transit', duration: 700, lineName: '5' },
    ])
    expect(proposedTrip([bikeTo5, walkTo4, walkTo5], 'transit', ['4'])?.id).toBe('walk-4')
    expect(proposedTrip([bikeTo5, walkTo4, walkTo5], 'transit', ['5'])?.id).toBe('walk-5')
    expect(proposedTrip([bikeTo5, walkTo4], 'transit')?.id).toBe('walk-4')
  })

  it('falls back to the best trip when none is of that kind', () => {
    expect(proposedTrip([ride, subway], 'bikeshare')?.id).toBe('subway')
  })
})

it('endpointPlace keeps a looked-up place id, else names the coordinates', () => {
  expect(endpointPlace({ name: 'Barclays Center', placeId: 'osm/way/1', lat: 40.68, lng: -73.97 })).toMatchObject({
    id: 'osm/way/1',
    name: { value: 'Barclays Center' },
    geometry: { value: { center: { lat: 40.68, lng: -73.97 } } },
  })
  expect(endpointPlace({ lat: 1, lng: 2 }).id).toBe('coords/1/2')
})
