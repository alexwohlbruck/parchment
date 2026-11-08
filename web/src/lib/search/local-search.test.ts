import { describe, expect, it } from 'vitest'
import { localAutocomplete, localResultAsPlace } from './local-search'

const saved = (name: string, externalId: string, extra: object = {}) => ({
  name,
  externalIds: { osm: externalId },
  lat: 40.7,
  lng: -74,
  ...extra,
})

describe('localAutocomplete', () => {
  it('returns only the coordinate when the query is one', () => {
    const results = localAutocomplete('40.7148341 -73.9915242', {
      savedPlaces: [saved('40 Wall St', 'node/1')],
      recentPlaces: [],
    })
    expect(results).toEqual([
      expect.objectContaining({ id: 'coords/40.7148341/-73.9915242', title: '40.7148341, -73.9915242' }),
    ])
  })

  it('matches word prefixes in any order, ignoring case and accents', () => {
    const sources = { savedPlaces: [saved('Café de Flore', 'node/1')], recentPlaces: [] }
    for (const query of ['cafe', 'FLORE caf', 'de fl']) {
      expect(localAutocomplete(query, sources).map(r => r.title)).toEqual(['Café de Flore'])
    }
    expect(localAutocomplete('flores', sources)).toEqual([])
  })

  it('ranks a name match above an address match, and saved above recent', () => {
    const results = localAutocomplete('park', {
      savedPlaces: [
        saved('Home', 'node/1', { address: '12 Park Pl' }),
        saved('Park Slope Library', 'node/2'),
      ],
      recentPlaces: [{ id: 'osm/node/3', title: 'Park Slope Food Coop', lat: 40.67, lng: -73.97, at: 1 }],
    })
    expect(results.map(r => r.title)).toEqual(['Park Slope Library', 'Park Slope Food Coop', 'Home'])
  })

  it('breaks ties by distance from the map centre', () => {
    const results = localAutocomplete(
      'deli',
      {
        savedPlaces: [
          saved('Deli Far', 'node/1', { lat: 34.05, lng: -118.24 }),
          saved('Deli Near', 'node/2', { lat: 40.71, lng: -74.0 }),
        ],
        recentPlaces: [],
      },
      { center: { lat: 40.71, lng: -74.0 } },
    )
    expect(results.map(r => r.title)).toEqual(['Deli Near', 'Deli Far'])
  })

  it('lists a place both saved and recent once, as the saved one', () => {
    const results = localAutocomplete('joe', {
      savedPlaces: [saved('Joe’s Pizza', 'node/1')],
      recentPlaces: [{ id: 'osm/node/1', title: 'Joe’s Pizza', at: 1 }],
    })
    expect(results).toHaveLength(1)
    expect(results[0].type).toBe('bookmark')
  })
})

describe('localResultAsPlace', () => {
  it('builds a point place that still matches its bookmark', () => {
    const [result] = localAutocomplete('joe', {
      savedPlaces: [saved('Joe’s Pizza', 'node/1', { address: '7 Carmine St' })],
      recentPlaces: [],
    })
    const place = localResultAsPlace(result)!
    expect(place.externalIds).toEqual({ osm: 'node/1' })
    expect(place.name.value).toBe('Joe’s Pizza')
    expect(place.address?.value.formatted).toBe('7 Carmine St')
    expect(place.geometry.value.center).toEqual({ lat: 40.7, lng: -74 })
  })
})
