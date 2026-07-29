/**
 * Unit tests for the Google Maps integration.
 *
 * This one straddles two Google APIs: the Places v1 endpoints (`places:*`,
 * key in an `X-Goog-Api-Key` header, field mask required) and the legacy
 * Geocoding API (key in the query string, status reported in the body rather
 * than the HTTP code). The tests pin both, because the failure conventions do
 * not transfer — a legacy `REQUEST_DENIED` arrives as HTTP 200 and would
 * otherwise be adapted as a valid empty result.
 *
 * The field mask is asserted explicitly: Places v1 returns ONLY the masked
 * fields, so dropping an entry from it silently strips data from every result
 * without any error.
 *
 * The API key must never reach a log line, so the logged URLs are redacted;
 * that redaction is covered too.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'

mock.module('../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const { GoogleMapsIntegration } = await import('./google-maps-integration')

const API_KEY = 'test-google-key'
const validConfig = { apiKey: API_KEY }

function configured() {
  const integration = new GoogleMapsIntegration()
  integration.initialize(validConfig)
  return integration
}

/** A Places v1 place resource the adapter can consume. */
const googlePlace = (over: Record<string, unknown> = {}) => ({
  id: 'ChIJplace',
  displayName: { text: 'Amelie’s French Bakery' },
  formattedAddress: '2424 N Davidson St, Charlotte, NC',
  types: ['bakery', 'cafe'],
  location: { latitude: 35.2271, longitude: -80.8431 },
  ...over,
})

/** A legacy Geocoding API result. */
const geocodeResult = (over: Record<string, unknown> = {}) => ({
  place_id: 'ChIJgeocode',
  formatted_address: '2424 N Davidson St, Charlotte, NC',
  types: ['street_address'],
  geometry: { location: { lat: 35.2271, lng: -80.8431 } },
  ...over,
})

const realFetch = globalThis.fetch
const realLog = console.log
/** Every fetch call, as [url, init]. */
let calls: [string, any][] = []
let fetchImpl: (url: string, init?: any) => Promise<any>
/** Everything the integration logged, so key redaction can be asserted. */
let logged: string[] = []

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

beforeEach(() => {
  calls = []
  logged = []
  fetchImpl = async () => ok({})
  globalThis.fetch = ((url: string, init?: any) => {
    calls.push([url, init])
    return fetchImpl(url, init)
  }) as any
  console.log = (...args: unknown[]) => {
    logged.push(args.map(String).join(' '))
  }
})

afterEach(() => {
  globalThis.fetch = realFetch
  console.log = realLog
})

describe('configuration', () => {
  test('requires an API key', () => {
    const integration = new GoogleMapsIntegration()

    expect(integration.validateConfig(validConfig)).toBe(true)
    expect(integration.validateConfig({ apiKey: '' })).toBe(false)
  })

  test('declares search, place info and geocoding', () => {
    expect(new GoogleMapsIntegration().capabilityIds).toEqual([
      'search',
      'placeInfo',
      'geocoding',
    ])
  })

  test('declares the Google source', () => {
    expect(new GoogleMapsIntegration().sources).toEqual(['google'])
  })
})

describe('testConnection', () => {
  test('probes the autocomplete endpoint', async () => {
    fetchImpl = async () => ok({ suggestions: [] })

    const result = await new GoogleMapsIntegration().testConnection(validConfig)

    expect(result).toEqual({ success: true })
    expect(calls[0][0]).toBe('https://places.googleapis.com/v1/places:autocomplete')
    expect(JSON.parse(calls[0][1].body)).toEqual({ input: 'test' })
  })

  test('rejects an empty key without a request', async () => {
    const result = await new GoogleMapsIntegration().testConnection({
      apiKey: '',
    })

    expect(result.success).toBe(false)
    expect(calls).toHaveLength(0)
  })

  test('sends the key in the Google header, never the query string', async () => {
    fetchImpl = async () => ok({})

    await new GoogleMapsIntegration().testConnection(validConfig)

    expect(calls[0][1].headers['X-Goog-Api-Key']).toBe(API_KEY)
    expect(calls[0][0]).not.toContain(API_KEY)
  })

  test('fails on a non-2xx response', async () => {
    fetchImpl = async () => ({ ok: false, status: 403 })

    const result = await new GoogleMapsIntegration().testConnection(validConfig)

    expect(result.success).toBe(false)
    expect(result.message).toContain('403')
  })

  test('fails when the body carries an API error despite a 200', async () => {
    // Google reports quota and permission problems inside a 200 body.
    fetchImpl = async () => ok({ error: { message: 'API key not valid' } })

    const result = await new GoogleMapsIntegration().testConnection(validConfig)

    expect(result).toEqual({ success: false, message: 'API key not valid' })
  })

  test('surfaces a network failure message', async () => {
    fetchImpl = async () => {
      throw new Error('ECONNRESET')
    }

    const result = await new GoogleMapsIntegration().testConnection(validConfig)

    expect(result).toEqual({ success: false, message: 'ECONNRESET' })
  })
})

describe('getPlaceInfo', () => {
  const info = (integration: any) => integration.capabilities.placeInfo.getPlaceInfo

  test('fetches the place resource by id', async () => {
    fetchImpl = async () => ok(googlePlace())

    const place = await info(configured())('ChIJplace')

    expect(place.name.value).toBe('Amelie’s French Bakery')
    expect(calls[0][0]).toContain('/v1/places/ChIJplace')
  })

  test('requests the full field mask Places v1 requires', async () => {
    // Places v1 returns ONLY masked fields; a missing entry silently drops data.
    fetchImpl = async () => ok(googlePlace())

    await info(configured())('ChIJplace')

    const mask = calls[0][1].headers['X-Goog-FieldMask']
    for (const field of [
      'id',
      'displayName',
      'formattedAddress',
      'location',
      'regularOpeningHours',
      'photos',
      'rating',
    ]) {
      expect(mask).toContain(field)
    }
  })

  test('passes a normalized language code', async () => {
    fetchImpl = async () => ok(googlePlace())

    await info(configured())('ChIJplace', { language: 'es-MX' })

    expect(new URL(calls[0][0]).searchParams.get('languageCode')).toBe('es')
  })

  test('falls back to English for an unsupported language', async () => {
    // getLanguageCode only recognizes the languages Parchment ships.
    fetchImpl = async () => ok(googlePlace())

    await info(configured())('ChIJplace', { language: 'de-DE' })

    expect(new URL(calls[0][0]).searchParams.get('languageCode')).toBe('en')
  })

  test('omits the language parameter when none is given', async () => {
    fetchImpl = async () => ok(googlePlace())

    await info(configured())('ChIJplace')

    expect(new URL(calls[0][0]).searchParams.get('languageCode')).toBeNull()
  })

  test('returns null for an unknown place', async () => {
    fetchImpl = async () => ({ ok: false, status: 404 })

    expect(await info(configured())('ChIJmissing')).toBeNull()
  })

  test('returns null on any other HTTP error', async () => {
    fetchImpl = async () => ({ ok: false, status: 500 })

    expect(await info(configured())('ChIJplace')).toBeNull()
  })

  test('returns null when the body carries an API error', async () => {
    fetchImpl = async () => ok({ error: { message: 'quota exceeded' } })

    expect(await info(configured())('ChIJplace')).toBeNull()
  })

  test('returns null rather than throwing on a network failure', async () => {
    fetchImpl = async () => {
      throw new Error('ECONNRESET')
    }

    expect(await info(configured())('ChIJplace')).toBeNull()
  })

  test('redacts the API key from the logged URL', async () => {
    fetchImpl = async () => ok(googlePlace())

    await info(configured())('ChIJplace')

    expect(logged.some((line) => line.includes(API_KEY))).toBe(false)
  })
})

describe('geocode', () => {
  test('adapts each legacy geocoding result', async () => {
    fetchImpl = async () => ok({ status: 'OK', results: [geocodeResult()] })

    const places = await configured().capabilities.geocoding.geocode(
      '2424 N Davidson St',
    )

    expect(places).toHaveLength(1)
    expect(places[0].name.value).toBe('2424 N Davidson St, Charlotte, NC')
  })

  test('uses the legacy endpoint with the key in the query string', async () => {
    // The legacy API has no header auth, unlike Places v1.
    fetchImpl = async () => ok({ status: 'OK', results: [] })

    await configured().capabilities.geocoding.geocode('somewhere')

    const url = new URL(calls[0][0])
    expect(url.origin + url.pathname).toBe(
      'https://maps.googleapis.com/maps/api/geocode/json',
    )
    expect(url.searchParams.get('key')).toBe(API_KEY)
    expect(url.searchParams.get('address')).toBe('somewhere')
  })

  test('passes a normalized language code', async () => {
    fetchImpl = async () => ok({ status: 'OK', results: [] })

    await configured().capabilities.geocoding.geocode('somewhere', undefined, undefined, {
      language: 'es-MX',
    })

    expect(new URL(calls[0][0]).searchParams.get('language')).toBe('es')
  })

  test('treats ZERO_RESULTS as an empty list, not a failure', async () => {
    fetchImpl = async () => ok({ status: 'ZERO_RESULTS', results: [] })

    expect(
      await configured().capabilities.geocoding.geocode('nowhere at all'),
    ).toEqual([])
  })

  test('returns an empty list when the body reports a non-OK status', async () => {
    // A legacy REQUEST_DENIED arrives as HTTP 200; only the body reveals it.
    fetchImpl = async () => ok({ status: 'REQUEST_DENIED', results: [] })

    expect(await configured().capabilities.geocoding.geocode('somewhere')).toEqual(
      [],
    )
  })

  test('returns an empty list on an HTTP error', async () => {
    fetchImpl = async () => ({ ok: false, status: 500 })

    expect(await configured().capabilities.geocoding.geocode('somewhere')).toEqual(
      [],
    )
  })

  test('maps the legacy lat/lng geometry onto the v1 location shape', async () => {
    fetchImpl = async () => ok({ status: 'OK', results: [geocodeResult()] })

    const [place] = await configured().capabilities.geocoding.geocode('addr')

    expect(place.geometry.value.center).toEqual({ lat: 35.2271, lng: -80.8431 })
  })

  test('tolerates a result with no geometry', async () => {
    fetchImpl = async () =>
      ok({ status: 'OK', results: [geocodeResult({ geometry: undefined })] })

    expect(
      await configured().capabilities.geocoding.geocode('addr'),
    ).toHaveLength(1)
  })
})

describe('reverseGeocode', () => {
  test('sends the point as a comma-joined latlng', async () => {
    fetchImpl = async () => ok({ status: 'OK', results: [geocodeResult()] })

    await configured().capabilities.geocoding.reverseGeocode(35.2271, -80.8431)

    expect(new URL(calls[0][0]).searchParams.get('latlng')).toBe(
      '35.2271,-80.8431',
    )
  })

  test('adapts the results', async () => {
    fetchImpl = async () => ok({ status: 'OK', results: [geocodeResult()] })

    const places = await configured().capabilities.geocoding.reverseGeocode(
      35.2271,
      -80.8431,
    )

    expect(places).toHaveLength(1)
  })

  test('returns an empty list when the body reports a non-OK status', async () => {
    fetchImpl = async () => ok({ status: 'OVER_QUERY_LIMIT', results: [] })

    expect(
      await configured().capabilities.geocoding.reverseGeocode(0, 0),
    ).toEqual([])
  })

  test('returns an empty list on a network failure', async () => {
    fetchImpl = async () => {
      throw new Error('ECONNRESET')
    }

    expect(
      await configured().capabilities.geocoding.reverseGeocode(0, 0),
    ).toEqual([])
  })
})

describe('searchPlaces', () => {
  const search = (integration: any) => integration.capabilities.search.searchPlaces
  const body = () => JSON.parse(calls[0][1].body)

  test('adapts each place from a text search', async () => {
    fetchImpl = async () => ok({ places: [googlePlace()] })

    const places = await search(configured())('bakery')

    expect(places).toHaveLength(1)
    expect(places[0].name.value).toBe('Amelie’s French Bakery')
  })

  test('posts the query to the text-search endpoint', async () => {
    fetchImpl = async () => ok({ places: [] })

    await search(configured())('bakery')

    expect(calls[0][0]).toBe('https://places.googleapis.com/v1/places:searchText')
    expect(calls[0][1].method).toBe('POST')
    expect(body().textQuery).toBe('bakery')
  })

  test('returns nothing when no key is configured', async () => {
    const integration = new GoogleMapsIntegration()
    integration.initialize({ apiKey: '' })

    expect(await search(integration)('bakery')).toEqual([])
    expect(calls).toHaveLength(0)
  })

  test('defaults the result count to 20', async () => {
    fetchImpl = async () => ok({ places: [] })

    await search(configured())('bakery')

    expect(body().maxResultCount).toBe(20)
  })

  test('honours an explicit limit', async () => {
    fetchImpl = async () => ok({ places: [] })

    await search(configured())('bakery', undefined, undefined, { limit: 5 })

    expect(body().maxResultCount).toBe(5)
  })

  test('biases to a circle when coordinates are given', async () => {
    fetchImpl = async () => ok({ places: [] })

    await search(configured())('bakery', 35.2271, -80.8431, { radius: 2000 })

    expect(body().locationBias).toEqual({
      circle: {
        center: { latitude: 35.2271, longitude: -80.8431 },
        radius: 2000,
      },
    })
  })

  test('defaults the bias radius to 50 km', async () => {
    fetchImpl = async () => ok({ places: [] })

    await search(configured())('bakery', 35.2271, -80.8431)

    expect(body().locationBias.circle.radius).toBe(50000)
  })

  test('omits the location bias without coordinates', async () => {
    fetchImpl = async () => ok({ places: [] })

    await search(configured())('bakery')

    expect(body().locationBias).toBeUndefined()
  })

  test('passes a normalized language code', async () => {
    fetchImpl = async () => ok({ places: [] })

    await search(configured())('bakery', undefined, undefined, {
      language: 'es-MX',
    })

    expect(body().languageCode).toBe('es')
  })

  test('returns an empty list when Google matches nothing', async () => {
    fetchImpl = async () => ok({ places: [] })

    expect(await search(configured())('nowhere')).toEqual([])
  })

  test('returns an empty list when the response has no places key', async () => {
    fetchImpl = async () => ok({})

    expect(await search(configured())('nowhere')).toEqual([])
  })

  test('returns an empty list when the body carries an API error', async () => {
    fetchImpl = async () => ok({ error: { message: 'quota exceeded' } })

    expect(await search(configured())('bakery')).toEqual([])
  })

  test('returns an empty list on an HTTP error', async () => {
    fetchImpl = async () => ({ ok: false, status: 429 })

    expect(await search(configured())('bakery')).toEqual([])
  })

  test('redacts the API key from the logged URL', async () => {
    fetchImpl = async () => ok({ places: [] })

    await search(configured())('bakery')

    expect(logged.some((line) => line.includes(API_KEY))).toBe(false)
  })
})
