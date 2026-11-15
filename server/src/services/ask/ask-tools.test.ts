import { describe, test, expect, mock, beforeEach } from 'bun:test'
import type { Place } from '../../types/place.types'

const mockLookupPlaces = mock(async () => [] as Place[])
const mockLookupPlace = mock(async () => null as Place | null)
const mockSearchByCategory = mock(async () => [] as Place[])
const reachGeometry = {
  type: 'Polygon',
  coordinates: [[[-74.01, 40.69], [-73.99, 40.69], [-73.99, 40.71], [-74.01, 40.71], [-74.01, 40.69]]],
}
const mockBarrelman = mock(async () =>
  Response.json({
    mode: 'walk',
    isochrones: {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: reachGeometry }],
    },
  }),
)

mock.module('../place.service', () => ({
  lookupPlacesByNameAndLocation: mockLookupPlaces,
  lookupEnrichedPlaceById: mockLookupPlace,
}))
mock.module('../search.service', () => ({ searchByCategory: mockSearchByCategory }))
mock.module('../category.service', () => ({ categoryService: { searchCategories: () => [] } }))
mock.module('../geocoding.service', () => ({ forwardGeocode: mock(async () => ({ results: [] })) }))
mock.module('../barrelman.service', () => ({ requestBarrelman: mockBarrelman }))

const { askTools } = await import('./ask-tools')
import type { AskContext } from './ask-tools'

const tool = (name: string) => askTools.find((t) => t.name === name)!

function context(userId = 'u1'): AskContext {
  return {
    userId,
    language: 'en-US',
    origin: { lat: 40.7, lng: -74 },
    now: new Date('2026-11-14T15:00:00Z'),
    seen: new Map(),
    emit: () => {},
  }
}

beforeEach(() => {
  for (const fn of [mockLookupPlaces, mockLookupPlace, mockSearchByCategory, mockBarrelman]) fn.mockClear()
})

describe('tool caching', () => {
  test('a repeated name search reuses the first lookup for the same user only', async () => {
    await tool('find_places').run({ query: 'ramen' }, context('u1'))
    await tool('find_places').run({ query: 'ramen ' }, context('u1'))
    expect(mockLookupPlaces).toHaveBeenCalledTimes(1)

    await tool('find_places').run({ query: 'ramen' }, context('u2'))
    expect(mockLookupPlaces).toHaveBeenCalledTimes(2)
  })

  test('place details are cached per user', async () => {
    await tool('get_place').run({ id: 'osm/node/1' }, context('u1')).catch(() => {})
    await tool('get_place').run({ id: 'osm/node/1' }, context('u1')).catch(() => {})
    await tool('get_place').run({ id: 'osm/node/1' }, context('u2')).catch(() => {})
    expect(mockLookupPlace).toHaveBeenCalledTimes(2)
  })

  test('category lists and reach are shared across users', async () => {
    const args = { mode: 'walk', minutes: 10, category_id: 'amenity/cafe' }
    await tool('places_within_reach').run(args, context('u1'))
    await tool('places_within_reach').run(args, context('u2'))
    expect(mockBarrelman).toHaveBeenCalledTimes(1)
    expect(mockSearchByCategory).toHaveBeenCalledTimes(1)
  })

  test('a failed lookup is retried rather than cached', async () => {
    mockLookupPlaces.mockRejectedValueOnce(new Error('down'))
    await expect(tool('find_places').run({ query: 'flaky' }, context())).rejects.toThrow('down')
    await tool('find_places').run({ query: 'flaky' }, context())
    expect(mockLookupPlaces).toHaveBeenCalledTimes(2)
  })
})

describe('places_within_reach', () => {
  test('keeps only places inside the reachable area and draws it', async () => {
    const at = (id: string, lat: number, lng: number) =>
      ({ id, name: { value: id }, geometry: { value: { center: { lat, lng } } } }) as unknown as Place
    mockSearchByCategory.mockResolvedValueOnce([at('inside', 40.7, -74), at('outside', 40.8, -74)])
    const events: unknown[] = []

    const result = (await tool('places_within_reach').run(
      { mode: 'bike', minutes: 7, category_id: 'amenity/bar' },
      { ...context(), emit: (event) => events.push(event) },
    )) as { places: { id: string }[] }

    expect(result.places.map((p) => p.id)).toEqual(['inside'])
    expect(events).toEqual([{ type: 'reach', geometry: reachGeometry }])
  })
})
