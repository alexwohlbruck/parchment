/**
 * Endpoint tests for the geocoding controller.
 *
 * Both routes are authenticated and delegate to whichever geocoding
 * integration has highest priority. The behaviour worth pinning: coordinate
 * range validation happens before any provider call, an unconfigured provider
 * is a 503 rather than a 500, and `limit` truncates the provider's results.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { authMockModule, setAuthUser, resetAuth } from '../test/auth-mock'
import { createTestApp, req } from '../test/app'

const result = (name: string) => ({ name, lat: 35.2, lng: -80.8 })

const geocode = mock(async (_query: string, _lat?: number, _lng?: number) => [
  result('First'),
  result('Second'),
  result('Third'),
])
const reverseGeocode = mock(async (_lat: number, _lng: number) => [
  result('123 Main St'),
  result('125 Main St'),
])

let configuredIntegrations: any[] = [{ integrationId: 'pelias' }]
let cachedInstance: unknown = { capabilities: { geocoding: { geocode, reverseGeocode } } }

mock.module('../services/integrations', () => ({
  integrationManager: {
    getConfiguredIntegrationsByCapability: () => configuredIntegrations,
    getCachedIntegrationInstance: () => cachedInstance,
  },
}))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

mock.module('../middleware/auth.middleware', () => authMockModule())

const geocoding = (await import('./geocoding.controller')).default
const app = createTestApp(geocoding)

beforeEach(() => {
  resetAuth()
  configuredIntegrations = [{ integrationId: 'pelias' }]
  cachedInstance = { capabilities: { geocoding: { geocode, reverseGeocode } } }
  geocode.mockClear()
  geocode.mockImplementation(async () => [
    result('First'),
    result('Second'),
    result('Third'),
  ])
  reverseGeocode.mockClear()
  reverseGeocode.mockImplementation(async () => [
    result('123 Main St'),
    result('125 Main St'),
  ])
})

describe('auth gating', () => {
  test('GET /geocoding/forward rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).get('/geocoding/forward', { query: { query: 'x' } })

    expect(res.status).toBe(401)
    expect(geocode).not.toHaveBeenCalled()
  })

  test('GET /geocoding/reverse rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).get('/geocoding/reverse', {
      query: { lat: '35.2', lng: '-80.8' },
    })

    expect(res.status).toBe(401)
    expect(reverseGeocode).not.toHaveBeenCalled()
  })
})

describe('GET /geocoding/forward', () => {
  test('geocodes a query and echoes it back with a count', async () => {
    const res = await req(app).get('/geocoding/forward', {
      query: { query: '123 Main St' },
    })

    expect(res.status).toBe(200)
    expect(res.body.query).toBe('123 Main St')
    expect(res.body.count).toBe(3)
    expect(res.body.integration).toBe('pelias')
  })

  test('passes optional lat/lng through as numbers for location bias', async () => {
    await req(app).get('/geocoding/forward', {
      query: { query: 'coffee', lat: '35.2', lng: '-80.8' },
    })

    expect(geocode.mock.calls[0][1]).toBe(35.2)
    expect(geocode.mock.calls[0][2]).toBe(-80.8)
  })

  test('omits the bias arguments when lat/lng are absent', async () => {
    await req(app).get('/geocoding/forward', { query: { query: 'coffee' } })

    expect(geocode.mock.calls[0][1]).toBeUndefined()
    expect(geocode.mock.calls[0][2]).toBeUndefined()
  })

  test('truncates results to the requested limit', async () => {
    const res = await req(app).get('/geocoding/forward', {
      query: { query: 'coffee', limit: 2 },
    })

    expect(res.body.results).toHaveLength(2)
    expect(res.body.count).toBe(2)
  })

  test('defaults to at most 10 results', async () => {
    geocode.mockResolvedValueOnce(
      Array.from({ length: 25 }, (_, i) => result(`Result ${i}`)),
    )

    const res = await req(app).get('/geocoding/forward', { query: { query: 'x' } })

    expect(res.body.results).toHaveLength(10)
  })

  test('422s on an empty query', async () => {
    const res = await req(app).get('/geocoding/forward', { query: { query: '' } })

    expect(res.status).toBe(422)
    expect(geocode).not.toHaveBeenCalled()
  })

  test('400s on a whitespace-only query', async () => {
    const res = await req(app).get('/geocoding/forward', { query: { query: '   ' } })

    expect(res.status).toBe(400)
    expect(geocode).not.toHaveBeenCalled()
  })

  test('422s when query is missing entirely', async () => {
    const res = await req(app).get('/geocoding/forward')

    expect(res.status).toBe(422)
  })

  test('503s when no geocoding integration is configured', async () => {
    configuredIntegrations = []

    const res = await req(app).get('/geocoding/forward', { query: { query: 'x' } })

    expect(res.status).toBe(503)
  })

  test('503s when the integration instance lacks the capability', async () => {
    cachedInstance = { capabilities: {} }

    const res = await req(app).get('/geocoding/forward', { query: { query: 'x' } })

    expect(res.status).toBe(503)
  })

  test('500s with the provider message when geocoding throws', async () => {
    geocode.mockRejectedValueOnce(new Error('pelias timeout'))

    const res = await req(app).get('/geocoding/forward', { query: { query: 'x' } })

    expect(res.status).toBe(500)
    expect(res.body.message).toBe('pelias timeout')
  })
})

describe('GET /geocoding/reverse', () => {
  test('reverse geocodes and echoes the parsed coordinates', async () => {
    const res = await req(app).get('/geocoding/reverse', {
      query: { lat: '35.2', lng: '-80.8' },
    })

    expect(res.status).toBe(200)
    expect(res.body.coordinates).toEqual({ lat: 35.2, lng: -80.8 })
    expect(reverseGeocode).toHaveBeenCalledWith(35.2, -80.8)
    expect(res.body.count).toBe(2)
  })

  test('422s when a coordinate is missing', async () => {
    const res = await req(app).get('/geocoding/reverse', { query: { lat: '35.2' } })

    expect(res.status).toBe(422)
    expect(reverseGeocode).not.toHaveBeenCalled()
  })

  test('400s on a non-numeric coordinate', async () => {
    const res = await req(app).get('/geocoding/reverse', {
      query: { lat: 'north', lng: '-80.8' },
    })

    expect(res.status).toBe(400)
    expect(reverseGeocode).not.toHaveBeenCalled()
  })

  for (const lat of ['91', '-91']) {
    test(`400s on out-of-range latitude ${lat}`, async () => {
      const res = await req(app).get('/geocoding/reverse', {
        query: { lat, lng: '0' },
      })

      expect(res.status).toBe(400)
      expect(reverseGeocode).not.toHaveBeenCalled()
    })
  }

  for (const lng of ['181', '-181']) {
    test(`400s on out-of-range longitude ${lng}`, async () => {
      const res = await req(app).get('/geocoding/reverse', {
        query: { lat: '0', lng },
      })

      expect(res.status).toBe(400)
      expect(reverseGeocode).not.toHaveBeenCalled()
    })
  }

  test('accepts the exact range boundaries', async () => {
    const res = await req(app).get('/geocoding/reverse', {
      query: { lat: '90', lng: '-180' },
    })

    expect(res.status).toBe(200)
    expect(reverseGeocode).toHaveBeenCalledWith(90, -180)
  })

  test('truncates results to the requested limit', async () => {
    const res = await req(app).get('/geocoding/reverse', {
      query: { lat: '0', lng: '0', limit: 1 },
    })

    expect(res.body.results).toHaveLength(1)
  })

  test('503s when no geocoding integration is configured', async () => {
    configuredIntegrations = []

    const res = await req(app).get('/geocoding/reverse', {
      query: { lat: '0', lng: '0' },
    })

    expect(res.status).toBe(503)
  })

  test('500s with the provider message when reverse geocoding throws', async () => {
    reverseGeocode.mockRejectedValueOnce(new Error('nominatim 429'))

    const res = await req(app).get('/geocoding/reverse', {
      query: { lat: '0', lng: '0' },
    })

    expect(res.status).toBe(500)
    expect(res.body.message).toBe('nominatim 429')
  })
})
