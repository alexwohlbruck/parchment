import { describe, test, expect, mock, beforeEach } from 'bun:test'

let geocoded: any[] = []
const geocodeCalls: string[] = []
mock.module('./geocoding.service', () => ({
  forwardGeocode: async (query: string) => {
    geocodeCalls.push(query)
    return { results: geocoded, integrationId: 'test' }
  },
}))

mock.module('../lib/logger', () => ({
  logError: () => {},
  logWarn: () => {},
}))

const { resolveCoordinateQuery } = await import('./coordinate-search.service')

beforeEach(() => {
  geocoded = []
  geocodeCalls.length = 0
})

describe('resolveCoordinateQuery', () => {
  test('labels coordinates and full plus codes by kind', async () => {
    expect(await resolveCoordinateQuery('(40.7148341, -73.9915242)')).toMatchObject({
      lat: 40.7148341,
      title: '40.7148341, -73.9915242',
      kind: 'Coordinates',
    })
    expect(await resolveCoordinateQuery('87G8P2C7+V2')).toMatchObject({
      lat: 40.722188,
      lng: -73.987437,
      title: '87G8P2C7+V2',
      kind: 'Plus code',
    })
  })

  test('recovers a short plus code near the town named after it, not a same-named state', async () => {
    geocoded = [
      { placeType: { value: 'State' }, geometry: { value: { center: { lat: 42.92, lng: -75.6 } } } },
      { placeType: { value: 'City' }, geometry: { value: { center: { lat: 40.66, lng: -73.94 } } } },
    ]
    const match = await resolveCoordinateQuery('P2C7+V2 New York, NY', { lat: 34.05, lng: -118.24 })
    expect(geocodeCalls).toEqual(['New York, NY'])
    expect(match).toMatchObject({ lat: 40.722188, lng: -73.987437, title: 'P2C7+V2 New York, NY' })
  })

  test('recovers a bare short plus code near the map centre without geocoding', async () => {
    const match = await resolveCoordinateQuery('P2C7+V2', { lat: 40.75, lng: -73.98 })
    expect(geocodeCalls).toEqual([])
    expect(match).toMatchObject({ lat: 40.722188, lng: -73.987437 })
  })

  test('finds a what3words address locally', async () => {
    expect(await resolveCoordinateQuery('///filled.count.soap')).toEqual({
      lat: 51.520847,
      lng: -0.195521,
      title: '///filled.count.soap',
      kind: 'what3words',
      description: 'what3words',
    })
    expect(await resolveCoordinateQuery('https://w3w.co/index.home.raft')).toMatchObject({
      lat: 51.521251,
      lng: -0.203586,
    })
  })

  test('returns nothing for three words that are not an address', async () => {
    expect(await resolveCoordinateQuery('maps.google.com')).toBeNull()
  })
})
