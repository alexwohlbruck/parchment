import { describe, expect, it } from 'vitest'
import type { Place } from '@/types/place.types'
import { arrivalParent, arrivalPointsQuery } from './arrival-points'

const airport = {
  id: 'osm/way/1',
  icon: { presetId: 'aeroway/aerodrome' },
  geometry: {
    value: {
      type: 'polygon',
      center: { lat: 40.5, lng: -73.5 },
      bounds: { minLat: 40, maxLat: 41, minLng: -74, maxLng: -73 },
    },
  },
} as unknown as Place

describe('arrivalPointsQuery', () => {
  it('describes a hydrated area by its preset and bounds', () => {
    expect(arrivalPointsQuery(airport, 'driving')).toEqual({
      presetId: 'aeroway/aerodrome',
      placeId: 'osm/way/1',
      mode: 'driving',
      north: 41,
      south: 40,
      east: -73,
      west: -74,
    })
  })

  it('asks nothing for a place without bounds or a preset', () => {
    const point = { ...airport, geometry: { value: { type: 'point', center: { lat: 1, lng: 1 } } } }
    expect(arrivalPointsQuery(point as unknown as Place, 'driving')).toBeNull()
    expect(arrivalPointsQuery({ ...airport, icon: null } as unknown as Place, 'driving')).toBeNull()
    expect(arrivalPointsQuery(null, 'driving')).toBeNull()
  })
})

describe('arrivalParent', () => {
  const terminal = { id: 'osm/way/2' }

  it('keeps the parent once one of its points becomes the destination', () => {
    expect(arrivalParent(terminal, airport, [terminal])).toBe(airport)
  })

  it('moves on when the destination is somewhere else', () => {
    const cafe = { id: 'osm/node/9' }
    expect(arrivalParent(cafe, airport, [terminal])).toBe(cafe)
    expect(arrivalParent(null, airport, [terminal])).toBeNull()
  })
})
