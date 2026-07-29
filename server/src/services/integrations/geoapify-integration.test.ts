/**
 * Unit tests for the Geoapify integration.
 *
 * Geoapify's coordinate conventions are inconsistent between endpoints and
 * that is where the bugs live: `bias`/`filter` take LON,LAT, reverse geocoding
 * takes named `lat`/`lon` params, and routing waypoints take LAT,LNG joined by
 * pipes. Each order is asserted explicitly, because swapping a pair produces a
 * perfectly valid request that searches the wrong hemisphere.
 *
 * Failure handling also differs on purpose: search and geocoding swallow errors
 * and return empty lists (a dead provider must not break the map), while
 * `getRoute` rethrows — a silently empty route would render as "no route
 * exists" rather than an outage.
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

const { GeoapifyIntegration } = await import('./geoapify-integration')
const { TravelMode } = await import('../../types/unified-routing.types')

const API_KEY = 'geoapify-key'
const validConfig = { apiKey: API_KEY }

function configured() {
  const integration = new GeoapifyIntegration()
  integration.initialize(validConfig)
  return integration
}

/** A Geoapify GeoJSON feature the adapter can consume. */
const feature = (over: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-80.8431, 35.2271] },
  properties: {
    place_id: 'geoapify-place-1',
    name: 'Amelie’s French Bakery',
    formatted: '2424 N Davidson St, Charlotte, NC',
    city: 'Charlotte',
    country: 'United States',
    ...over,
  },
})

/** A single-leg driving route response. */
const routeResponse = () => ({
  properties: { time: 420 },
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-80.84, 35.22],
          [-80.83, 35.23],
        ],
      },
      properties: {
        distance: 1500,
        time: 420,
        legs: [
          {
            distance: 1500,
            time: 420,
            steps: [
              {
                from_index: 0,
                to_index: 1,
                distance: 1500,
                time: 420,
                instruction: { text: 'Head north' },
              },
            ],
          },
        ],
      },
    },
  ],
})

const routeRequest = (over: Record<string, unknown> = {}) => ({
  waypoints: [
    { coordinate: { lat: 35.22, lng: -80.84 } },
    { coordinate: { lat: 35.23, lng: -80.83 } },
  ],
  mode: TravelMode.DRIVING,
  ...over,
})

const bounds = { north: 35.3, south: 35.1, east: -80.7, west: -80.9 }

/** Params of the request at `index`. */
const paramsOf = (index = 0) => http.get.mock.calls[index][1].params

const realLog = console.log

beforeEach(() => {
  http.reset()
  console.log = () => {}
})

afterEach(() => {
  console.log = realLog
})

describe('configuration', () => {
  test('requires an API key', () => {
    const integration = new GeoapifyIntegration()

    expect(integration.validateConfig(validConfig)).toBe(true)
    expect(integration.validateConfig({ apiKey: '' })).toBe(false)
    expect(integration.validateConfig({ apiKey: 123 } as any)).toBe(false)
  })

  test('initialize refuses a missing key', () => {
    expect(() => new GeoapifyIntegration().initialize({ apiKey: '' })).toThrow(
      'API Key is required',
    )
  })

  test('declares all five capabilities', () => {
    expect(new GeoapifyIntegration().capabilityIds).toEqual([
      'searchCategory',
      'autocomplete',
      'geocoding',
      'placeInfo',
      'routing',
    ])
  })

  test('claims no data sources of its own', () => {
    // Place details come from OSM; Geoapify is only a lookup and routing engine.
    expect(new GeoapifyIntegration().sources).toEqual([])
  })

  test('refuses to work before initialization', async () => {
    await expect(new GeoapifyIntegration().geocode('bakery')).rejects.toThrow(
      'has not been initialized',
    )
    expect(http.get).not.toHaveBeenCalled()
  })
})

describe('routing metadata', () => {
  const metadata = new GeoapifyIntegration().capabilities.routing.metadata

  test('advertises the four road modes it can map', () => {
    expect(metadata.supportedModes).toEqual([
      'driving',
      'walking',
      'cycling',
      'motorcycle',
    ])
  })

  test('does not claim transit or alternatives', () => {
    expect(metadata.features.transit).toBe(false)
    expect(metadata.features.alternatives).toBe(false)
    expect(metadata.limits.maxAlternatives).toBe(0)
  })

  test('claims only the avoid preferences it forwards', () => {
    const prefs = metadata.supportedPreferences

    expect(prefs.avoidTolls).toBe(true)
    expect(prefs.avoidHighways).toBe(true)
    expect(prefs.avoidFerries).toBe(true)
    // Transit-only preferences must stay false or the router would offer them.
    expect(prefs.maxTransfers).toBe(false)
    expect(prefs.wheelchairAccessible).toBe(false)
  })
})

describe('testConnection', () => {
  test('probes the geocoding endpoint', async () => {
    http.get.mockResolvedValueOnce({ status: 200, data: { features: [] } })

    const result = await new GeoapifyIntegration().testConnection(validConfig)

    expect(result).toEqual({ success: true })
    expect(http.get.mock.calls[0][0]).toBe(
      'https://api.geoapify.com/v1/geocode/search',
    )
    expect(paramsOf()).toMatchObject({ text: 'test', limit: 1, apiKey: API_KEY })
  })

  test('rejects an empty key without a request', async () => {
    const result = await new GeoapifyIntegration().testConnection({ apiKey: '' })

    expect(result.success).toBe(false)
    expect(http.get).not.toHaveBeenCalled()
  })

  test('fails on an unexpected response', async () => {
    http.get.mockResolvedValueOnce({ status: 204, data: null })

    const result = await new GeoapifyIntegration().testConnection(validConfig)

    expect(result).toEqual({
      success: false,
      message: 'Unexpected response from Geoapify API',
    })
  })

  test('prefers the API error message over the transport message', async () => {
    http.get.mockRejectedValueOnce({
      message: 'Request failed with status code 401',
      response: { status: 401, data: { message: 'Invalid apiKey' } },
    })

    const result = await new GeoapifyIntegration().testConnection(validConfig)

    expect(result.message).toBe('Invalid apiKey')
  })

  test('falls back to the transport message', async () => {
    http.get.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const result = await new GeoapifyIntegration().testConnection(validConfig)

    expect(result.message).toBe('ECONNREFUSED')
  })
})

describe('searchByCategory', () => {
  test('translates the preset into a Geoapify category', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [feature()] } })

    const places = await configured().searchByCategory('tourism/hotel', bounds)

    expect(places).toHaveLength(1)
    expect(http.get.mock.calls[0][0]).toBe('https://api.geoapify.com/v2/places')
    expect(paramsOf().categories).toBe('accommodation.hotel')
  })

  test('skips the request entirely for an unmapped preset', async () => {
    expect(
      await configured().searchByCategory('amenity/does_not_exist', bounds),
    ).toEqual([])
    expect(http.get).not.toHaveBeenCalled()
  })

  test('builds the rect filter as west,south,east,north', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await configured().searchByCategory('tourism/hotel', bounds)

    expect(paramsOf().filter).toBe('rect:-80.9,35.1,-80.7,35.3')
  })

  test('defaults the limit to 100', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await configured().searchByCategory('tourism/hotel', bounds)

    expect(paramsOf().limit).toBe(100)
  })

  test('honours an explicit limit', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await configured().searchByCategory('tourism/hotel', bounds, { limit: 25 })

    expect(paramsOf().limit).toBe(25)
  })

  test('returns an empty list when the response has no features', async () => {
    http.get.mockResolvedValueOnce({ data: {} })

    expect(await configured().searchByCategory('tourism/hotel', bounds)).toEqual(
      [],
    )
  })

  test('returns an empty list rather than throwing on a request failure', async () => {
    http.get.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    expect(await configured().searchByCategory('tourism/hotel', bounds)).toEqual(
      [],
    )
  })
})

describe('getAutocomplete', () => {
  test('adapts each suggestion', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [feature()] } })

    const places = await configured().getAutocomplete('bakery')

    expect(places).toHaveLength(1)
    expect(places[0].name.value).toBe('Amelie’s French Bakery')
    expect(http.get.mock.calls[0][0]).toBe(
      'https://api.geoapify.com/v1/geocode/autocomplete',
    )
  })

  test('skips the request for a query under two characters', async () => {
    expect(await configured().getAutocomplete('b')).toEqual([])
    expect(await configured().getAutocomplete('')).toEqual([])
    expect(http.get).not.toHaveBeenCalled()
  })

  test('defaults the limit to 10 and asks for GeoJSON', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await configured().getAutocomplete('bakery')

    expect(paramsOf().limit).toBe(10)
    expect(paramsOf().format).toBe('geojson')
  })

  test('writes the proximity bias as lon,lat', async () => {
    // Geoapify's bias is LON first — the opposite of the method signature.
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await configured().getAutocomplete('bakery', 35.2271, -80.8431)

    expect(paramsOf().bias).toBe('proximity:-80.8431,35.2271')
  })

  test('converts the circle filter radius from meters to kilometers', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await configured().getAutocomplete('bakery', 35.2271, -80.8431, {
      radius: 2500,
    })

    expect(paramsOf().filter).toBe('circle:-80.8431,35.2271,2.5')
  })

  test('omits the circle filter when no radius is given', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await configured().getAutocomplete('bakery', 35.2271, -80.8431)

    expect(paramsOf().filter).toBeUndefined()
  })

  test('omits the bias when only one coordinate is supplied', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await configured().getAutocomplete('bakery', 35.2271)

    expect(paramsOf().bias).toBeUndefined()
  })

  test('returns an empty list on a request failure', async () => {
    http.get.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    expect(await configured().getAutocomplete('bakery')).toEqual([])
  })
})

describe('geocode', () => {
  test('adapts each result', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [feature()] } })

    const places = await configured().geocode('2424 N Davidson St')

    expect(places).toHaveLength(1)
    expect(http.get.mock.calls[0][0]).toBe(
      'https://api.geoapify.com/v1/geocode/search',
    )
  })

  test('skips the request for an empty query', async () => {
    expect(await configured().geocode('')).toEqual([])
    expect(http.get).not.toHaveBeenCalled()
  })

  test('writes the proximity bias as lon,lat', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    await configured().geocode('bakery', 35.2271, -80.8431)

    expect(paramsOf().bias).toBe('proximity:-80.8431,35.2271')
  })

  test('returns an empty list when there are no features', async () => {
    http.get.mockResolvedValueOnce({ data: {} })

    expect(await configured().geocode('nowhere')).toEqual([])
  })

  test('returns an empty list on a request failure', async () => {
    http.get.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    expect(await configured().geocode('bakery')).toEqual([])
  })
})

describe('reverseGeocode', () => {
  test('sends lat and lon as named parameters', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [feature()] } })

    const places = await configured().reverseGeocode(35.2271, -80.8431)

    expect(places).toHaveLength(1)
    expect(http.get.mock.calls[0][0]).toBe(
      'https://api.geoapify.com/v1/geocode/reverse',
    )
    expect(paramsOf()).toMatchObject({ lat: 35.2271, lon: -80.8431 })
  })

  test('returns an empty list when nothing is at the point', async () => {
    http.get.mockResolvedValueOnce({ data: {} })

    expect(await configured().reverseGeocode(0, 0)).toEqual([])
  })

  test('returns an empty list on a request failure', async () => {
    http.get.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    expect(await configured().reverseGeocode(35.2271, -80.8431)).toEqual([])
  })
})

describe('getPlaceInfo', () => {
  test('fetches the place-details endpoint by id', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [feature()] } })

    const place = await configured().getPlaceInfo('geoapify-place-1')

    expect(place.name.value).toBe('Amelie’s French Bakery')
    expect(http.get.mock.calls[0][0]).toBe(
      'https://api.geoapify.com/v2/place-details',
    )
    expect(paramsOf().id).toBe('geoapify-place-1')
  })

  test('returns null when the place is unknown', async () => {
    http.get.mockResolvedValueOnce({ data: { features: [] } })

    expect(await configured().getPlaceInfo('missing')).toBeNull()
  })

  test('returns null on a request failure', async () => {
    http.get.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    expect(await configured().getPlaceInfo('geoapify-place-1')).toBeNull()
  })
})

describe('getRoute', () => {
  test('adapts the route response', async () => {
    http.get.mockResolvedValueOnce({ data: routeResponse() })

    const route = await configured().getRoute(routeRequest() as any)

    expect(route.routes).toHaveLength(1)
    expect(route.metadata.provider).toBe('geoapify')
  })

  test('joins waypoints as lat,lng pairs separated by pipes', async () => {
    // Routing takes LAT first — the opposite of the bias parameters above.
    http.get.mockResolvedValueOnce({ data: routeResponse() })

    await configured().getRoute(routeRequest() as any)

    expect(paramsOf().waypoints).toBe('35.22,-80.84|35.23,-80.83')
  })

  test('rejects a request with fewer than two waypoints', async () => {
    await expect(
      configured().getRoute(
        routeRequest({ waypoints: [{ coordinate: { lat: 1, lng: 2 } }] }) as any,
      ),
    ).rejects.toThrow('At least 2 waypoints')
    expect(http.get).not.toHaveBeenCalled()
  })

  test('maps each supported travel mode to its Geoapify name', async () => {
    for (const [mode, expected] of [
      [TravelMode.DRIVING, 'drive'],
      [TravelMode.WALKING, 'walk'],
      [TravelMode.CYCLING, 'bicycle'],
      [TravelMode.MOTORCYCLE, 'motorcycle'],
    ] as const) {
      http.reset()
      http.get.mockResolvedValueOnce({ data: routeResponse() })

      await configured().getRoute(routeRequest({ mode }) as any)

      expect(paramsOf().mode).toBe(expected)
    }
  })

  test('rejects an unsupported travel mode', async () => {
    await expect(
      configured().getRoute(routeRequest({ mode: 'teleport' }) as any),
    ).rejects.toThrow('Unsupported travel mode')
  })

  test('requests elevation only for the human-powered modes', async () => {
    http.get.mockResolvedValueOnce({ data: routeResponse() })
    await configured().getRoute(routeRequest({ mode: TravelMode.CYCLING }) as any)
    expect(paramsOf().details).toContain('elevation')

    http.reset()
    http.get.mockResolvedValueOnce({ data: routeResponse() })
    await configured().getRoute(routeRequest({ mode: TravelMode.DRIVING }) as any)
    expect(paramsOf().details).not.toContain('elevation')
  })

  test('always asks for instruction and route details', async () => {
    http.get.mockResolvedValueOnce({ data: routeResponse() })

    await configured().getRoute(routeRequest() as any)

    expect(paramsOf().details).toContain('instruction_details')
    expect(paramsOf().details).toContain('route_details')
  })

  test('joins the avoid preferences with pipes', async () => {
    http.get.mockResolvedValueOnce({ data: routeResponse() })

    await configured().getRoute(
      routeRequest({
        preferences: {
          avoidTolls: true,
          avoidHighways: true,
          avoidFerries: true,
        },
      }) as any,
    )

    expect(paramsOf().avoid).toBe('tolls|highways|ferries')
  })

  test('omits the avoid parameter when nothing is avoided', async () => {
    http.get.mockResolvedValueOnce({ data: routeResponse() })

    await configured().getRoute(routeRequest({ preferences: {} }) as any)

    expect(paramsOf().avoid).toBeUndefined()
  })

  test('maps the distance optimization to the short route type', async () => {
    http.get.mockResolvedValueOnce({ data: routeResponse() })

    await configured().getRoute(
      routeRequest({ preferences: { optimize: 'distance' } }) as any,
    )

    expect(paramsOf().type).toBe('short')
  })

  test('maps the balanced optimization through unchanged', async () => {
    http.get.mockResolvedValueOnce({ data: routeResponse() })

    await configured().getRoute(
      routeRequest({ preferences: { optimize: 'balanced' } }) as any,
    )

    expect(paramsOf().type).toBe('balanced')
  })

  test('leaves the type unset for the default time optimization', async () => {
    // Time is Geoapify's default; sending a type would be redundant.
    http.get.mockResolvedValueOnce({ data: routeResponse() })

    await configured().getRoute(
      routeRequest({ preferences: { optimize: 'time' } }) as any,
    )

    expect(paramsOf().type).toBeUndefined()
  })

  test('passes a normalized instruction language', async () => {
    http.get.mockResolvedValueOnce({ data: routeResponse() })

    await configured().getRoute(routeRequest({ language: 'es' }) as any)

    expect(paramsOf().lang).toBe('es')
  })

  test('omits the language when none is requested', async () => {
    http.get.mockResolvedValueOnce({ data: routeResponse() })

    await configured().getRoute(routeRequest() as any)

    expect(paramsOf().lang).toBeUndefined()
  })

  test('throws when Geoapify returns no route data', async () => {
    http.get.mockResolvedValueOnce({ data: null })

    await expect(configured().getRoute(routeRequest() as any)).rejects.toThrow(
      'Geoapify routing error',
    )
  })

  test('rethrows a transport failure rather than returning no routes', async () => {
    // An empty result would be shown to the user as "no route exists".
    http.get.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    await expect(configured().getRoute(routeRequest() as any)).rejects.toThrow(
      'Geoapify routing error: ECONNREFUSED',
    )
  })
})
