/**
 * Unit tests for the Pelias integration.
 *
 * Two transports live side by side here: `searchPlaces`/`reverseGeocode`/
 * `getPlaceInfo` go through axios, while `getAutocomplete` uses global `fetch`
 * and builds its URL with `URLSearchParams`. Both are exercised below, because
 * the parameter names differ between them in ways a shared helper would have
 * caught (`focus.point.lat` as a param object vs. a query string).
 *
 * Radius units are the subtle part: callers pass METERS, Pelias wants
 * KILOMETERS, and each path does its own division. Getting that wrong widens a
 * 50 m boundary to 50 km without any error surfacing.
 *
 * Autocomplete is deliberately failure-tolerant — a Pelias outage returns an
 * empty list rather than throwing, since a dead suggest endpoint must not break
 * the search box.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import { createAxiosMock } from '../../test/axios-mock'

const http = createAxiosMock()
mock.module('axios', () => http.module)

mock.module('../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const { PeliasIntegration } = await import('./pelias-integration')

const HOST = 'http://pelias.test'
const validConfig = { host: HOST }

function configured(config = validConfig) {
  const integration = new PeliasIntegration()
  integration.initialize(config)
  return integration
}

/** A minimal Pelias GeoJSON feature the adapter can consume. */
const feature = (over: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-80.8431, 35.2271] },
  properties: {
    id: 'way/123',
    gid: 'openstreetmap:venue:way/123',
    source: 'openstreetmap',
    layer: 'venue',
    name: 'Amelie’s French Bakery',
    label: 'Amelie’s French Bakery, Charlotte, NC, USA',
    ...over,
  },
})

const realFetch = globalThis.fetch
/** Records every fetch URL so query-string assembly can be asserted. */
let fetchCalls: string[] = []
let fetchImpl: (url: string) => Promise<any>

beforeEach(() => {
  http.reset()
  fetchCalls = []
  fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ features: [feature()] }),
  })
  globalThis.fetch = ((url: string) => {
    fetchCalls.push(url)
    return fetchImpl(url)
  }) as any
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('configuration', () => {
  test('requires a host', () => {
    const integration = new PeliasIntegration()

    expect(integration.validateConfig(validConfig)).toBe(true)
    expect(integration.validateConfig({ host: '' })).toBe(false)
    expect(integration.validateConfig({ host: 123 } as any)).toBe(false)
  })

  test('initialize refuses a missing host', () => {
    expect(() => new PeliasIntegration().initialize({ host: '' })).toThrow(
      'Host is required',
    )
  })

  test('declares geocoding and autocomplete', () => {
    expect(new PeliasIntegration().capabilityIds).toEqual([
      'geocoding',
      'autocomplete',
    ])
  })

  test('declares the OSM and OpenAddresses sources', () => {
    expect(new PeliasIntegration().sources).toEqual(['osm', 'openaddresses'])
  })

  test('refuses to search before initialization', async () => {
    await expect(
      new PeliasIntegration().searchPlaces('bakery'),
    ).rejects.toThrow('has not been initialized')
    expect(http.get).not.toHaveBeenCalled()
  })

  test('refuses to autocomplete before initialization', async () => {
    await expect(
      new PeliasIntegration().getAutocomplete('bakery'),
    ).rejects.toThrow('has not been initialized')
  })
})

describe('testConnection', () => {
  test('probes the search endpoint', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    const result = await new PeliasIntegration().testConnection(validConfig)

    expect(result).toEqual({ success: true })
    expect(http.get.mock.calls[0][0]).toBe(`${HOST}/v1/search`)
    expect(http.get.mock.calls[0][1].params).toMatchObject({ text: 'test', size: 1 })
  })

  test('rejects a config with no host without a request', async () => {
    const result = await new PeliasIntegration().testConnection({ host: '' })

    expect(result.success).toBe(false)
    expect(http.get).not.toHaveBeenCalled()
  })

  test('includes the API key when one is configured', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await new PeliasIntegration().testConnection({
      host: HOST,
      apiKey: 'secret',
    } as any)

    expect(http.get.mock.calls[0][1].params.api_key).toBe('secret')
  })

  test('omits the API key parameter entirely when unset', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await new PeliasIntegration().testConnection(validConfig)

    expect(http.get.mock.calls[0][1].params.api_key).toBeUndefined()
  })

  test('surfaces a connection failure message', async () => {
    http.get.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const result = await new PeliasIntegration().testConnection(validConfig)

    expect(result).toEqual({ success: false, message: 'ECONNREFUSED' })
  })
})

describe('URL building', () => {
  test('strips a trailing slash from the host', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await new PeliasIntegration().testConnection({ host: `${HOST}/` })

    expect(http.get.mock.calls[0][0]).toBe(`${HOST}/v1/search`)
  })
})

describe('searchPlaces', () => {
  test('adapts each feature into a Place', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [feature()] } })

    const places = await configured().searchPlaces('bakery')

    expect(places).toHaveLength(1)
    expect(places[0].name.value).toBe('Amelie’s French Bakery')
  })

  test('returns an empty list when Pelias matches nothing', async () => {
    http.get.mockResolvedValueOnce({ data: {} })

    expect(await configured().searchPlaces('nowhere')).toEqual([])
  })

  test('defaults the result size to 10', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await configured().searchPlaces('bakery')

    expect(http.get.mock.calls[0][1].params.size).toBe(10)
  })

  test('honours an explicit limit', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await configured().searchPlaces('bakery', undefined, undefined, { limit: 3 })

    expect(http.get.mock.calls[0][1].params.size).toBe(3)
  })

  test('applies a focus point when coordinates are supplied', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await configured().searchPlaces('bakery', 35.2, -80.8)

    const params = http.get.mock.calls[0][1].params
    expect(params['focus.point.lat']).toBe(35.2)
    expect(params['focus.point.lon']).toBe(-80.8)
  })

  test('omits the focus point when only one coordinate is given', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await configured().searchPlaces('bakery', 35.2)

    expect(http.get.mock.calls[0][1].params['focus.point.lat']).toBeUndefined()
  })

  test('converts the boundary radius from meters to kilometers', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await configured().searchPlaces('bakery', 35.2, -80.8, { radius: 5000 })

    expect(http.get.mock.calls[0][1].params['boundary.circle.radius']).toBe(5)
  })

  test('leaves the boundary off when no radius is given', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await configured().searchPlaces('bakery', 35.2, -80.8)

    expect(
      http.get.mock.calls[0][1].params['boundary.circle.radius'],
    ).toBeUndefined()
  })

  test('sends the configured API key', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await configured({ host: HOST, apiKey: 'secret' } as any).searchPlaces('x')

    expect(http.get.mock.calls[0][1].params.api_key).toBe('secret')
  })
})

describe('reverseGeocode', () => {
  test('queries the reverse endpoint for a single result', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [feature()] } })

    const features = await configured().capabilities.geocoding.reverseGeocode(
      35.2,
      -80.8,
    )

    expect(features).toHaveLength(1)
    const [url, config] = http.get.mock.calls[0]
    expect(url).toBe(`${HOST}/v1/reverse`)
    expect(config.params).toEqual({
      'point.lat': 35.2,
      'point.lon': -80.8,
      size: 1,
    })
  })

  test('returns an empty list when nothing is nearby', async () => {
    http.get.mockResolvedValueOnce({ data: {} })

    expect(
      await configured().capabilities.geocoding.reverseGeocode(0, 0),
    ).toEqual([])
  })
})

describe('getAutocomplete', () => {
  test('adapts suggestions from the fetch response', async () => {
    const places = await configured().getAutocomplete('bakery')

    expect(places).toHaveLength(1)
    expect(places[0].name.value).toBe('Amelie’s French Bakery')
  })

  test('skips the request for a query under two characters', async () => {
    expect(await configured().getAutocomplete('b')).toEqual([])
    expect(await configured().getAutocomplete('')).toEqual([])
    expect(fetchCalls).toHaveLength(0)
  })

  test('restricts the layers to venues and addresses', async () => {
    await configured().getAutocomplete('bakery')

    expect(new URL(fetchCalls[0]).searchParams.get('layers')).toBe(
      'venue,address',
    )
  })

  test('applies the focus point when coordinates are supplied', async () => {
    await configured().getAutocomplete('bakery', 35.2, -80.8)

    const params = new URL(fetchCalls[0]).searchParams
    expect(params.get('focus.point.lat')).toBe('35.2')
    expect(params.get('focus.point.lon')).toBe('-80.8')
  })

  test('converts the default 50 km boundary from its meter value', async () => {
    await configured().getAutocomplete('bakery', 35.2, -80.8)

    expect(
      new URL(fetchCalls[0]).searchParams.get('boundary.circle.radius'),
    ).toBe('50')
  })

  test('converts an explicit radius from meters to kilometers', async () => {
    await configured().getAutocomplete('bakery', 35.2, -80.8, { radius: 2500 })

    expect(
      new URL(fetchCalls[0]).searchParams.get('boundary.circle.radius'),
    ).toBe('2.5')
  })

  test('omits location parameters with no coordinates', async () => {
    await configured().getAutocomplete('bakery')

    const params = new URL(fetchCalls[0]).searchParams
    expect(params.get('focus.point.lat')).toBeNull()
    expect(params.get('boundary.circle.radius')).toBeNull()
  })

  test('strips a trailing slash from the host', async () => {
    await configured({ host: `${HOST}/` }).getAutocomplete('bakery')

    expect(fetchCalls[0].startsWith(`${HOST}/v1/autocomplete`)).toBe(true)
  })

  test('returns an empty list on a non-2xx response', async () => {
    fetchImpl = async () => ({ ok: false, status: 502, statusText: 'Bad Gateway' })

    expect(await configured().getAutocomplete('bakery')).toEqual([])
  })

  test('returns an empty list when Pelias reports errors in the body', async () => {
    // A 200 with a `geocoding.errors` array is still a failed query.
    fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        geocoding: { errors: ['invalid parameter'] },
        features: [feature()],
      }),
    })

    expect(await configured().getAutocomplete('bakery')).toEqual([])
  })

  test('still returns results when Pelias only warns', async () => {
    fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        geocoding: { warnings: ['performance'] },
        features: [feature()],
      }),
    })

    expect(await configured().getAutocomplete('bakery')).toHaveLength(1)
  })

  test('returns an empty list when there are no features', async () => {
    fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({}) })

    expect(await configured().getAutocomplete('bakery')).toEqual([])
  })

  test('swallows a network failure rather than breaking the search box', async () => {
    fetchImpl = async () => {
      throw new Error('ECONNREFUSED')
    }

    expect(await configured().getAutocomplete('bakery')).toEqual([])
  })
})

describe('getPlaceInfo', () => {
  const info = (integration: any) => integration.capabilities.placeInfo.getPlaceInfo

  test('resolves a bare OSM type/id pair', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [feature()] } })

    const place = await info(configured())('way/123')

    expect(place.name.value).toBe('Amelie’s French Bakery')
    expect(http.get.mock.calls[0][0]).toBe(`${HOST}/v1/place`)
    expect(http.get.mock.calls[0][1].params.ids).toBe(
      'openstreetmap:way:123',
    )
  })

  test('strips the pelias/ provider prefix', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [feature()] } })

    await info(configured())('pelias/way/123')

    expect(http.get.mock.calls[0][1].params.ids).toBe('openstreetmap:way:123')
  })

  test('unwraps a fully-qualified gid', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [feature()] } })

    await info(configured())('openstreetmap:venue:way/123')

    expect(http.get.mock.calls[0][1].params.ids).toBe('openstreetmap:way:123')
  })

  test('defaults to the node type for an id with no slash', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [feature()] } })

    await info(configured())('456')

    expect(http.get.mock.calls[0][1].params.ids).toBe('openstreetmap:node:456')
  })

  test('identifies itself with a User-Agent', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [feature()] } })

    await info(configured())('way/123')

    expect(http.get.mock.calls[0][1].headers['User-Agent']).toBe('Parchment/1.0')
  })

  test('returns null when the place is unknown', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    expect(await info(configured())('way/999')).toBeNull()
  })

  test('returns null rather than throwing on a request failure', async () => {
    http.get.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    expect(await info(configured())('way/123')).toBeNull()
  })
})
