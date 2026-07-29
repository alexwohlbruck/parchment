/**
 * Unit tests for the Nominatim integration.
 *
 * The location-bias path is the one worth pinning down: Nominatim has no
 * radius parameter, so a radius is converted into a `viewbox` bounding box —
 * meters to kilometers, then kilometers to degrees at ~111 km/deg. Two
 * conversions in a row means an off-by-1000 is easy and silent; it just returns
 * results from the wrong city.
 *
 * `getPlaceInfo` also reshapes ids twice: `node/123` becomes the lookup form
 * `N123`, and an unknown OSM type is rejected before any request goes out
 * rather than being sent as a malformed `osm_ids`.
 *
 * The OSM usage policy requires a descriptive User-Agent, so headers are
 * asserted on every outbound call.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createAxiosMock } from '../../test/axios-mock'

const http = createAxiosMock()
mock.module('axios', () => http.module)

mock.module('../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const { NominatimIntegration } = await import('./nominatim-integration')

const HOST = 'https://nominatim.test'
const validConfig = { host: HOST }

function configured(config = validConfig) {
  const integration = new NominatimIntegration()
  integration.initialize(config)
  return integration
}

/** A minimal Nominatim jsonv2 result the adapter can consume. */
const result = (over: Record<string, unknown> = {}) => ({
  place_id: 1234,
  osm_type: 'way',
  osm_id: 123,
  lat: '35.2271',
  lon: '-80.8431',
  name: 'Amelie’s French Bakery',
  display_name: 'Amelie’s French Bakery, Charlotte, NC, USA',
  category: 'amenity',
  type: 'cafe',
  address: { city: 'Charlotte', state: 'North Carolina', country: 'United States' },
  extratags: {},
  // The adapter reads the title from `namedetails` (the object's own OSM name
  // tags), never from `display_name`, which describes the surrounding area.
  namedetails: { name: 'Amelie’s French Bakery' },
  ...over,
})

/** The last request's params, for the call at `index`. */
const paramsOf = (index = 0) => http.get.mock.calls[index][1].params

beforeEach(() => {
  http.reset()
})

describe('configuration', () => {
  test('requires a host', () => {
    const integration = new NominatimIntegration()

    expect(integration.validateConfig(validConfig)).toBe(true)
    expect(integration.validateConfig({ host: '' })).toBe(false)
    expect(integration.validateConfig(undefined as any)).toBe(false)
  })

  test('initialize refuses a missing host', () => {
    expect(() => new NominatimIntegration().initialize({ host: '' })).toThrow(
      'Host is required',
    )
  })

  test('declares search, geocoding and place info', () => {
    expect(new NominatimIntegration().capabilityIds).toEqual([
      'search',
      'geocoding',
      'placeInfo',
    ])
  })

  test('declares the OSM source', () => {
    expect(new NominatimIntegration().sources).toEqual(['osm'])
  })

  test('refuses to search before initialization', async () => {
    await expect(
      new NominatimIntegration().searchPlaces('bakery'),
    ).rejects.toThrow('has not been initialized')
    expect(http.get).not.toHaveBeenCalled()
  })
})

describe('testConnection', () => {
  test('probes the search endpoint', async () => {
    http.get.mockResolvedValueOnce({ data: [] })

    const outcome = await new NominatimIntegration().testConnection(validConfig)

    expect(outcome).toEqual({ success: true })
    expect(http.get.mock.calls[0][0]).toBe(`${HOST}/search`)
    expect(paramsOf()).toMatchObject({ q: 'test', format: 'json', limit: 1 })
  })

  test('rejects an invalid config without a request', async () => {
    const outcome = await new NominatimIntegration().testConnection({ host: '' })

    expect(outcome.success).toBe(false)
    expect(http.get).not.toHaveBeenCalled()
  })

  test('sends the User-Agent the OSM usage policy requires', async () => {
    http.get.mockResolvedValueOnce({ data: [] })

    await new NominatimIntegration().testConnection(validConfig)

    expect(http.get.mock.calls[0][1].headers['User-Agent']).toBeDefined()
  })

  test('surfaces a connection failure message', async () => {
    http.get.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const outcome = await new NominatimIntegration().testConnection(validConfig)

    expect(outcome).toEqual({ success: false, message: 'ECONNREFUSED' })
  })

  test('strips a trailing slash from the host', async () => {
    http.get.mockResolvedValueOnce({ data: [] })

    await new NominatimIntegration().testConnection({ host: `${HOST}/` })

    expect(http.get.mock.calls[0][0]).toBe(`${HOST}/search`)
  })
})

describe('searchPlaces', () => {
  test('adapts each result into a Place', async () => {
    http.get.mockResolvedValueOnce({ data: [result()] })

    const places = await configured().searchPlaces('bakery')

    expect(places).toHaveLength(1)
    expect(places[0].name.value).toBe('Amelie’s French Bakery')
  })

  test('requests the rich detail fields the adapter depends on', async () => {
    http.get.mockResolvedValueOnce({ data: [] })

    await configured().searchPlaces('bakery')

    expect(paramsOf()).toMatchObject({
      format: 'jsonv2',
      addressdetails: '1',
      extratags: '1',
      namedetails: '1',
      polygon_geojson: '1',
      dedupe: '1',
    })
  })

  test('defaults the limit to 50 and the language to English', async () => {
    http.get.mockResolvedValueOnce({ data: [] })

    await configured().searchPlaces('bakery')

    expect(paramsOf().limit).toBe('50')
    expect(paramsOf()['accept-language']).toBe('en')
  })

  test('honours an explicit limit and language', async () => {
    http.get.mockResolvedValueOnce({ data: [] })

    await configured().searchPlaces('bakery', undefined, undefined, {
      limit: 5,
      language: 'de',
    })

    expect(paramsOf().limit).toBe('5')
    expect(paramsOf()['accept-language']).toBe('de')
  })

  test('returns an empty list when nothing matches', async () => {
    http.get.mockResolvedValueOnce({ data: [] })

    expect(await configured().searchPlaces('nowhere')).toEqual([])
  })

  test('returns an empty list when the body is not an array', async () => {
    http.get.mockResolvedValueOnce({ data: { error: 'Unable to geocode' } })

    expect(await configured().searchPlaces('bakery')).toEqual([])
  })

  test('returns an empty list for an empty body', async () => {
    http.get.mockResolvedValueOnce({ data: null })

    expect(await configured().searchPlaces('bakery')).toEqual([])
  })
})

describe('location bias', () => {
  test('adds no viewbox without coordinates', async () => {
    http.get.mockResolvedValueOnce({ data: [] })

    await configured().searchPlaces('bakery')

    expect(paramsOf().viewbox).toBeUndefined()
    expect(paramsOf().bounded).toBeUndefined()
  })

  test('needs both coordinates before biasing', async () => {
    http.get.mockResolvedValueOnce({ data: [] })

    await configured().searchPlaces('bakery', 35.2)

    expect(paramsOf().viewbox).toBeUndefined()
  })

  test('bounds the search to the viewbox when biasing', async () => {
    http.get.mockResolvedValueOnce({ data: [] })

    await configured().searchPlaces('bakery', 35.2, -80.8)

    expect(paramsOf().bounded).toBe(1)
  })

  test('defaults to a 10 km box when no radius is given', async () => {
    http.get.mockResolvedValueOnce({ data: [] })

    await configured().searchPlaces('bakery', 35, -80)

    // 10 km / 111 km-per-degree ≈ 0.0901 degrees on each side.
    const [minLng, minLat, maxLng, maxLat] = paramsOf()
      .viewbox.split(',')
      .map(Number)
    expect(maxLng - minLng).toBeCloseTo(0.18018, 4)
    expect(maxLat - minLat).toBeCloseTo(0.18018, 4)
    expect((minLng + maxLng) / 2).toBeCloseTo(-80, 6)
    expect((minLat + maxLat) / 2).toBeCloseTo(35, 6)
  })

  test('converts a radius in meters through kilometers to degrees', async () => {
    http.get.mockResolvedValueOnce({ data: [] })

    // 5550 m -> 5.55 km -> 0.05 deg per side.
    await configured().searchPlaces('bakery', 35, -80, { radius: 5550 })

    const [minLng, , maxLng] = paramsOf().viewbox.split(',').map(Number)
    expect(maxLng - minLng).toBeCloseTo(0.1, 6)
  })

  test('orders the viewbox as minLon,minLat,maxLon,maxLat', async () => {
    http.get.mockResolvedValueOnce({ data: [] })

    await configured().searchPlaces('bakery', 35, -80, { radius: 11100 })

    expect(paramsOf().viewbox).toBe('-80.1,34.9,-79.9,35.1')
  })
})

describe('reverseGeocode', () => {
  test('adapts the single result into a one-element list', async () => {
    http.get.mockResolvedValueOnce({ data: result() })

    const places = await configured().capabilities.geocoding.reverseGeocode(
      35.2,
      -80.8,
    )

    expect(places).toHaveLength(1)
    expect(places[0].name.value).toBe('Amelie’s French Bakery')
  })

  test('sends lng as Nominatim’s lon parameter', async () => {
    http.get.mockResolvedValueOnce({ data: result() })

    await configured().capabilities.geocoding.reverseGeocode(35.2, -80.8)

    expect(http.get.mock.calls[0][0]).toBe(`${HOST}/reverse`)
    expect(paramsOf()).toMatchObject({ lat: 35.2, lon: -80.8, format: 'jsonv2' })
  })

  test('returns an empty list when nothing is at the point', async () => {
    http.get.mockResolvedValueOnce({ data: null })

    expect(
      await configured().capabilities.geocoding.reverseGeocode(0, 0),
    ).toEqual([])
  })

  test('returns an empty list rather than throwing on a request failure', async () => {
    http.get.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    expect(
      await configured().capabilities.geocoding.reverseGeocode(35.2, -80.8),
    ).toEqual([])
  })
})

describe('getPlaceInfo', () => {
  const info = (integration: any) => integration.capabilities.placeInfo.getPlaceInfo

  test('looks the place up by its N/W/R-prefixed id', async () => {
    http.get.mockResolvedValueOnce({ data: [result()] })

    const place = await info(configured())('way/123')

    expect(place.name.value).toBe('Amelie’s French Bakery')
    expect(http.get.mock.calls[0][0]).toBe(`${HOST}/lookup`)
    expect(paramsOf().osm_ids).toBe('W123')
  })

  test('prefixes each OSM type with its initial', async () => {
    for (const [id, expected] of [
      ['node/1', 'N1'],
      ['way/2', 'W2'],
      ['relation/3', 'R3'],
    ] as const) {
      http.reset()
      http.get.mockResolvedValueOnce({ data: [result()] })

      await info(configured())(id)

      expect(paramsOf().osm_ids).toBe(expected)
    }
  })

  test('strips the osm/ provider prefix', async () => {
    http.get.mockResolvedValueOnce({ data: [result()] })

    await info(configured())('osm/way/123')

    expect(paramsOf().osm_ids).toBe('W123')
  })

  test('assumes a node for an id with no type', async () => {
    http.get.mockResolvedValueOnce({ data: [result()] })

    await info(configured())('123')

    expect(paramsOf().osm_ids).toBe('N123')
  })

  test('rejects an unknown OSM type before making a request', async () => {
    expect(await info(configured())('building/123')).toBeNull()
    expect(http.get).not.toHaveBeenCalled()
  })

  test('returns null when the lookup finds nothing', async () => {
    http.get.mockResolvedValueOnce({ data: [] })

    expect(await info(configured())('way/999')).toBeNull()
  })

  test('returns null when the body is not an array', async () => {
    http.get.mockResolvedValueOnce({ data: { error: 'Not found' } })

    expect(await info(configured())('way/999')).toBeNull()
  })

  test('returns null rather than throwing on a request failure', async () => {
    http.get.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    expect(await info(configured())('way/123')).toBeNull()
  })

  test('sends the User-Agent on lookups too', async () => {
    http.get.mockResolvedValueOnce({ data: [result()] })

    await info(configured())('way/123')

    expect(http.get.mock.calls[0][1].headers['User-Agent']).toBeDefined()
  })
})
