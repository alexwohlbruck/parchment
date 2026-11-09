import { describe, expect, test } from 'bun:test'
import { isTappedPlace } from './tapped-place'

const hit = (presetId: string, center: { lat: number; lng: number }, type = 'point') =>
  ({
    name: { value: 'Somewhere', sourceId: 'osm', timestamp: '' },
    icon: { category: 'default', icon: 'marker', iconPack: 'lucide', presetId },
    geometry: { value: { type, center }, sourceId: 'osm', timestamp: '' },
  }) as any

const TAP = { lat: 40.6749, lng: -73.954156 }

describe('isTappedPlace', () => {
  test('a POI right under the tap', () => {
    expect(isTappedPlace(hit('amenity/kindergarten', { lat: 40.6748878, lng: -73.9541689 }), TAP.lat, TAP.lng)).toBe(true)
  })

  test('a point POI across the street', () => {
    expect(isTappedPlace(hit('amenity/cafe', { lat: 40.6753, lng: -73.9541 }), TAP.lat, TAP.lng)).toBe(false)
  })

  test('an area POI whatever its centre', () => {
    expect(isTappedPlace(hit('leisure/park', { lat: 40.66, lng: -73.97 }, 'polygon'), TAP.lat, TAP.lng)).toBe(true)
  })

  test.each(['address', 'area', 'building', 'building/apartments'])('not a %s', presetId => {
    expect(isTappedPlace(hit(presetId, TAP), TAP.lat, TAP.lng)).toBe(false)
  })

  test('not an unnamed hit', () => {
    expect(isTappedPlace({ ...hit('amenity/cafe', TAP), name: undefined }, TAP.lat, TAP.lng)).toBe(false)
  })
})
