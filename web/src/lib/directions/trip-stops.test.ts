import { describe, it, expect } from 'vitest'
import { tripPlaceStops, type TripStopSegment } from './trip-stops'
import type { Place } from '@/types/place.types'

const rack = {
  id: 'osm/node/1',
  name: { value: 'Rack' },
} as unknown as Place

const segment = (
  end: TripStopSegment['end'],
  endTime = '2026-09-09T15:44:00Z',
): TripStopSegment => ({ end, endTime })

describe('tripPlaceStops', () => {
  it('returns the place-bearing boundaries between segments', () => {
    const stops = tripPlaceStops([
      segment({ location: { lat: 1, lng: 2 }, label: 'Bike parking', place: rack }),
      segment({ location: { lat: 3, lng: 4 }, place: undefined }),
    ])

    expect(stops).toEqual([
      {
        id: '0-osm/node/1',
        segmentIndex: 0,
        place: rack,
        label: 'Bike parking',
        lngLat: { lat: 1, lng: 2 },
        time: '2026-09-09T15:44:00Z',
      },
    ])
  })

  it('ignores the last segment, whose end is the destination', () => {
    expect(
      tripPlaceStops([
        segment({ location: { lat: 3, lng: 4 }, place: rack }),
      ]),
    ).toEqual([])
  })

  it('skips boundaries with no place or no location', () => {
    expect(
      tripPlaceStops([
        segment({ location: { lat: 1, lng: 2 }, label: 'Your bike' }),
        segment({ place: rack }),
        segment({ location: { lat: 5, lng: 6 }, place: rack }),
      ]),
    ).toEqual([])
  })

  it('falls back to the place name when the plan gave no label', () => {
    const stops = tripPlaceStops([
      segment({ location: { lat: 1, lng: 2 }, place: rack }),
      segment({ location: { lat: 3, lng: 4 } }),
    ])
    expect(stops[0].label).toBe('Rack')
  })

  it('handles a missing segment list', () => {
    expect(tripPlaceStops(undefined)).toEqual([])
  })
})
