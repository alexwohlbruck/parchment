import { describe, expect, test } from 'bun:test'
import { labelPlaces } from './places-package.service'
import type { PlacesPackage } from '../../types/offline-package.types'

const pkg = (places: PlacesPackage['places']): PlacesPackage => ({
  version: 1,
  bounds: [0, 0, 1, 1],
  generatedAt: '2026-11-22T00:00:00Z',
  places,
})

describe('labelPlaces', () => {
  test('names the preset and picks its icon', () => {
    const [cafe] = labelPlaces(
      pkg([{ id: 'node/1', name: 'Joe', category: 'amenity/cafe', lng: 0, lat: 0 }]),
      'en-US',
    ).places
    expect(cafe.placeType).toBe('Cafe')
    expect(cafe.iconPack).toBe('maki')
    expect(cafe.icon).toBeTruthy()
  })

  test('leaves transit stops and uncategorised places alone', () => {
    const places = labelPlaces(
      pkg([
        { id: 'node/2', name: 'Thing', category: null, lng: 0, lat: 0 },
        {
          id: 'stop/1/A',
          name: 'Union Sq',
          category: 'public_transport/station',
          lng: 0,
          lat: 0,
          transit: { feedId: '1', stopId: 'A', routes: [] },
        },
      ]),
      'en-US',
    ).places
    expect(places.every(p => p.placeType === undefined && p.icon === undefined)).toBe(true)
  })
})
