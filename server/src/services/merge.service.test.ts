import { describe, test, expect } from 'bun:test'
import {
  calculateAddressSimilarity,
  mergePlacesCollection,
} from './merge.service'
import { SOURCE } from '../lib/constants'
import type { Address, Place } from '../types/place.types'

// ── Test fixtures ────────────────────────────────────────────────────────────

type PlaceOverrides = {
  id?: string
  name?: string
  lat?: number
  lng?: number
  address?: Address | null
  sourceId?: string
}

function makePlace({
  id = 'place-1',
  name = 'Starbucks',
  lat = 40.7128,
  lng = -74.006,
  address = null,
  sourceId = SOURCE.OSM,
}: PlaceOverrides = {}): Place {
  return {
    id,
    externalIds: { [sourceId]: id },
    name: { value: name, sourceId },
    description: null,
    placeType: { value: 'Cafe', sourceId },
    geometry: { value: { type: 'point', center: { lat, lng } }, sourceId },
    photos: [],
    address: address ? { value: address, sourceId } : null,
    contactInfo: {
      phone: null,
      email: null,
      website: null,
      socials: {},
    },
    openingHours: null,
    amenities: {},
    sources: [{ id: sourceId, name: sourceId, url: '' }],
    lastUpdated: '2024-01-01T00:00:00.000Z',
    createdAt: '2024-01-01T00:00:00.000Z',
  }
}

/** ~22m east of the reference point at this latitude */
const LNG_22M = -74.006 + 0.00026

// ── calculateAddressSimilarity ───────────────────────────────────────────────

describe('calculateAddressSimilarity', () => {
  test('returns null when either place has no address data', () => {
    const withAddress = makePlace({ address: { street1: '123 Main St' } })
    const withoutAddress = makePlace({ id: 'place-2' })

    expect(calculateAddressSimilarity(withAddress, withoutAddress)).toBeNull()
    expect(calculateAddressSimilarity(withoutAddress, withAddress)).toBeNull()
    expect(
      calculateAddressSimilarity(withoutAddress, withoutAddress),
    ).toBeNull()
  })

  test('returns null when no street can be extracted from an address', () => {
    const cityOnly = makePlace({ address: { locality: 'New York' } })
    const withStreet = makePlace({
      id: 'place-2',
      address: { street1: '123 Main St' },
    })

    expect(calculateAddressSimilarity(cityOnly, withStreet)).toBeNull()
  })

  test('returns 0 when house numbers on the same street conflict', () => {
    const place1 = makePlace({ address: { street1: '123 Main St' } })
    const place2 = makePlace({
      id: 'place-2',
      address: { street1: '456 Main St' },
    })

    expect(calculateAddressSimilarity(place1, place2)).toBe(0)
  })

  test('scores matching addresses highly despite abbreviations', () => {
    const place1 = makePlace({ address: { street1: '123 Main St' } })
    const place2 = makePlace({
      id: 'place-2',
      address: { formatted: '123 Main Street, New York, NY 10001' },
    })

    const similarity = calculateAddressSimilarity(place1, place2)
    expect(similarity).not.toBeNull()
    expect(similarity!).toBeGreaterThanOrEqual(0.7)
  })
})

// ── mergePlacesCollection ────────────────────────────────────────────────────

describe('mergePlacesCollection', () => {
  test('a directly conflicting house number blocks a merge', () => {
    const place1 = makePlace({
      id: 'osm-1',
      name: 'Starbucks',
      address: { street1: '123 Main St' },
    })
    const place2 = makePlace({
      id: 'osm-2',
      name: 'Starbucks',
      lng: LNG_22M,
      address: { street1: '456 Main St' },
      sourceId: SOURCE.FOURSQUARE,
    })

    const result = mergePlacesCollection([place1, place2])

    expect(result).toHaveLength(2)
  })

  test('merges same-named places at the same address', () => {
    const place1 = makePlace({
      id: 'osm-1',
      name: 'Starbucks',
      address: { street1: '123 Main St' },
    })
    const place2 = makePlace({
      id: 'fsq-1',
      name: 'Starbucks',
      lng: LNG_22M,
      address: { formatted: '123 Main Street, New York, NY 10001' },
      sourceId: SOURCE.FOURSQUARE,
    })

    const result = mergePlacesCollection([place1, place2])

    expect(result).toHaveLength(1)
    expect(result[0].sources).toHaveLength(2)
  })

  test('still merges when one place has no address data', () => {
    const place1 = makePlace({
      id: 'osm-1',
      name: 'Starbucks',
      address: { street1: '123 Main St' },
    })
    const place2 = makePlace({
      id: 'fsq-1',
      name: 'Starbucks',
      lng: LNG_22M,
      sourceId: SOURCE.FOURSQUARE,
    })

    const result = mergePlacesCollection([place1, place2])

    expect(result).toHaveLength(1)
  })
})
