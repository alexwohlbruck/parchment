import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'

let configured: any[] = []
mock.module('./integrations', () => ({
  integrationManager: { getConfiguredIntegrations: () => configured },
}))

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
const { parseWhat3words } = await import('./what3words.service')

const realFetch = globalThis.fetch
const fetched: string[] = []

beforeEach(() => {
  configured = [{ integrationId: 'what3words', config: { apiKey: 'k' } }]
  geocoded = []
  geocodeCalls.length = 0
  fetched.length = 0
  globalThis.fetch = (async (url: string) => {
    fetched.push(url)
    const words = new URL(url).searchParams.get('words')
    if (words !== 'filled.count.soap') return new Response('{}', { status: 400 })
    return Response.json({
      words,
      nearestPlace: 'Bayswater, London',
      coordinates: { lat: 51.520847, lng: -0.195521 },
    })
  }) as any
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('parseWhat3words', () => {
  test('reads the shapes a three-word address is shared in', () => {
    for (const query of [
      '///filled.count.soap',
      'filled.count.soap',
      ' ///Filled.Count.Soap ',
      'https://w3w.co/filled.count.soap',
      'https://what3words.com/filled.count.soap',
    ]) {
      expect(parseWhat3words(query)).toBe('filled.count.soap')
    }
    expect(parseWhat3words('///indice.casa.balsa')).toBe('indice.casa.balsa')
    expect(parseWhat3words('///ссылка.отвар.доска')).toBe('ссылка.отвар.доска')
  })

  test('ignores anything that is not three words', () => {
    for (const query of ['filled.count', 'filled count soap', '///filled.count.soap.x', '1.2.3', '40.7, -73.9']) {
      expect(parseWhat3words(query)).toBeNull()
    }
  })
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

  test('looks up a what3words address, once', async () => {
    const first = await resolveCoordinateQuery('///filled.count.soap')
    expect(first).toEqual({
      lat: 51.520847,
      lng: -0.195521,
      title: '///filled.count.soap',
      kind: 'what3words',
      description: 'Bayswater, London',
    })
    await resolveCoordinateQuery('filled.count.soap')
    expect(fetched).toHaveLength(1)
  })

  test('returns nothing for an unknown address or without a key', async () => {
    expect(await resolveCoordinateQuery('///no.such.place')).toBeNull()
    configured = []
    expect(await resolveCoordinateQuery('///other.three.words')).toBeNull()
    expect(fetched.filter(u => u.includes('other.three.words'))).toHaveLength(0)
  })
})
