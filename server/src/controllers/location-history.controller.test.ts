/**
 * Endpoint tests for the location-history passthrough.
 *
 * The server holds no cleartext config for a `user-e2ee` integration — the
 * client forwards the upstream endpoint and token per request. So the tests
 * cover the credential middleware, the range/coordinate parsing that happens
 * before any upstream call, and the deliberate opacity of the 502: upstream
 * errors must never surface, because an axios failure can carry URL fragments
 * or token fingerprints.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import {
  authMockModule,
  setAuthUser,
  setHasPermission,
  resetAuth,
} from '../test/auth-mock'
import { createTestApp, req } from '../test/app'

const getLocationHistory = mock(async (_creds: unknown, _opts: any) => ({
  points: [{ lat: 35.2, lng: -80.8, at: '2026-01-01T00:00:00Z' }],
}))
const getPlaceVisitHistory = mock(async (_creds: unknown, _opts: any) => ({
  visitCount: 3,
  recent: [],
}))

let integration: unknown = {
  capabilities: { locationHistory: { getLocationHistory, getPlaceVisitHistory } },
}

mock.module('../services/integrations', () => ({
  integrationManager: {
    getIntegrationRegistry: () => ({ getIntegration: () => integration }),
  },
}))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

mock.module('../middleware/auth.middleware', () => authMockModule())

const locationHistory = (await import('./location-history.controller')).default
const app = createTestApp(locationHistory)

/** Valid e2ee credential headers. */
const creds = {
  'x-integration-endpoint': 'https://dawarich.test',
  'x-integration-token': 'upstream-token',
}

const range = { start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' }

beforeEach(() => {
  resetAuth()
  integration = {
    capabilities: { locationHistory: { getLocationHistory, getPlaceVisitHistory } },
  }
  getLocationHistory.mockClear()
  getLocationHistory.mockImplementation(async () => ({
    points: [{ lat: 35.2, lng: -80.8, at: '2026-01-01T00:00:00Z' }],
  }))
  getPlaceVisitHistory.mockClear()
  getPlaceVisitHistory.mockImplementation(async () => ({ visitCount: 3, recent: [] }))
})

describe('gating', () => {
  test('rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).get('/location-history', {
      query: range,
      headers: creds,
    })

    expect(res.status).toBe(401)
    expect(getLocationHistory).not.toHaveBeenCalled()
  })

  test('rejects a caller without location:sharing', async () => {
    setHasPermission(false)

    const res = await req(app).get('/location-history', {
      query: range,
      headers: creds,
    })

    expect(res.status).toBe(403)
  })
})

describe('integration credentials', () => {
  test('400s when the endpoint header is missing', async () => {
    const res = await req(app).get('/location-history', {
      query: range,
      headers: { 'x-integration-token': 'upstream-token' },
    })

    expect(res.status).toBe(400)
    expect(getLocationHistory).not.toHaveBeenCalled()
  })

  test('400s when the token header is missing', async () => {
    const res = await req(app).get('/location-history', {
      query: range,
      headers: { 'x-integration-endpoint': 'https://dawarich.test' },
    })

    expect(res.status).toBe(400)
    expect(getLocationHistory).not.toHaveBeenCalled()
  })

  test('400s on a non-http(s) endpoint scheme', async () => {
    const res = await req(app).get('/location-history', {
      query: range,
      headers: { ...creds, 'x-integration-endpoint': 'file:///etc/passwd' },
    })

    expect(res.status).toBe(400)
    expect(getLocationHistory).not.toHaveBeenCalled()
  })

  test('400s on a malformed endpoint URL', async () => {
    const res = await req(app).get('/location-history', {
      query: range,
      headers: { ...creds, 'x-integration-endpoint': 'https://' },
    })

    expect(res.status).toBe(400)
  })

  test('forwards the credentials to the integration without persisting them', async () => {
    await req(app).get('/location-history', { query: range, headers: creds })

    expect(getLocationHistory.mock.calls[0][0]).toEqual({
      endpoint: 'https://dawarich.test',
      token: 'upstream-token',
    })
  })
})

describe('GET /location-history', () => {
  test('returns the upstream history for a valid range', async () => {
    const res = await req(app).get('/location-history', {
      query: range,
      headers: creds,
    })

    expect(res.status).toBe(200)
    expect(res.body.points).toHaveLength(1)
  })

  test('parses the range into Date objects', async () => {
    await req(app).get('/location-history', { query: range, headers: creds })

    const opts = getLocationHistory.mock.calls[0][1]
    expect(opts.range.start).toBeInstanceOf(Date)
    expect(opts.range.start.toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  test('400s on an unparseable date', async () => {
    const res = await req(app).get('/location-history', {
      query: { start: 'yesterday', end: '2026-01-02T00:00:00Z' },
      headers: creds,
    })

    expect(res.status).toBe(400)
    expect(getLocationHistory).not.toHaveBeenCalled()
  })

  test('400s when start is not before end', async () => {
    const res = await req(app).get('/location-history', {
      query: { start: range.end, end: range.start },
      headers: creds,
    })

    expect(res.status).toBe(400)
    expect(getLocationHistory).not.toHaveBeenCalled()
  })

  test('400s when start equals end', async () => {
    const res = await req(app).get('/location-history', {
      query: { start: range.start, end: range.start },
      headers: creds,
    })

    expect(res.status).toBe(400)
  })

  test('422s when the range params are missing', async () => {
    const res = await req(app).get('/location-history', { headers: creds })

    expect(res.status).toBe(422)
  })

  test('passes an optional stats range through', async () => {
    await req(app).get('/location-history', {
      query: {
        ...range,
        statsStart: '2025-01-01T00:00:00Z',
        statsEnd: '2026-01-01T00:00:00Z',
      },
      headers: creds,
    })

    expect(getLocationHistory.mock.calls[0][1].statsRange.start).toBeInstanceOf(Date)
  })

  test('drops an invalid stats range instead of failing the request', async () => {
    const res = await req(app).get('/location-history', {
      query: { ...range, statsStart: 'nope', statsEnd: '2026-01-01T00:00:00Z' },
      headers: creds,
    })

    expect(res.status).toBe(200)
    expect(getLocationHistory.mock.calls[0][1].statsRange).toBeUndefined()
  })

  test('drops a backwards stats range', async () => {
    await req(app).get('/location-history', {
      query: {
        ...range,
        statsStart: '2026-01-01T00:00:00Z',
        statsEnd: '2025-01-01T00:00:00Z',
      },
      headers: creds,
    })

    expect(getLocationHistory.mock.calls[0][1].statsRange).toBeUndefined()
  })

  test('passes the timezone through', async () => {
    await req(app).get('/location-history', {
      query: { ...range, timezone: 'America/New_York' },
      headers: creds,
    })

    expect(getLocationHistory.mock.calls[0][1].timezone).toBe('America/New_York')
  })

  test('503s when the provider has no locationHistory capability', async () => {
    integration = { capabilities: {} }

    const res = await req(app).get('/location-history', {
      query: range,
      headers: creds,
    })

    expect(res.status).toBe(503)
  })

  test('503s when the integration is not registered', async () => {
    integration = null

    const res = await req(app).get('/location-history', {
      query: range,
      headers: creds,
    })

    expect(res.status).toBe(503)
  })

  test('502s without echoing the upstream failure detail', async () => {
    getLocationHistory.mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED https://dawarich.test?token=abc'), {
        response: { status: 500 },
      }),
    )

    const res = await req(app).get('/location-history', {
      query: range,
      headers: creds,
    })

    expect(res.status).toBe(502)
    // The upstream message could carry URL fragments or token fingerprints.
    expect(JSON.stringify(res.body)).not.toContain('dawarich.test')
    expect(JSON.stringify(res.body)).not.toContain('token=abc')
  })
})

describe('GET /location-history/place', () => {
  const place = { lat: '35.2', lng: '-80.8' }

  test('returns the visit aggregate for a coordinate', async () => {
    const res = await req(app).get('/location-history/place', {
      query: place,
      headers: creds,
    })

    expect(res.status).toBe(200)
    expect(res.body.visitCount).toBe(3)
    expect(getPlaceVisitHistory.mock.calls[0][1]).toMatchObject({
      lat: 35.2,
      lng: -80.8,
    })
  })

  test('400s on non-numeric coordinates', async () => {
    const res = await req(app).get('/location-history/place', {
      query: { lat: 'north', lng: '-80.8' },
      headers: creds,
    })

    expect(res.status).toBe(400)
    expect(getPlaceVisitHistory).not.toHaveBeenCalled()
  })

  test('passes a complete bounds box through', async () => {
    await req(app).get('/location-history/place', {
      query: { ...place, minLat: '35', minLng: '-81', maxLat: '36', maxLng: '-80' },
      headers: creds,
    })

    expect(getPlaceVisitHistory.mock.calls[0][1].bounds).toEqual({
      minLat: 35,
      minLng: -81,
      maxLat: 36,
      maxLng: -80,
    })
  })

  test('drops a half-formed bounds box rather than sending a partial bbox', async () => {
    await req(app).get('/location-history/place', {
      query: { ...place, minLat: '35', minLng: '-81' },
      headers: creds,
    })

    expect(getPlaceVisitHistory.mock.calls[0][1].bounds).toBeUndefined()
  })

  test('drops an inverted bounds box', async () => {
    await req(app).get('/location-history/place', {
      query: { ...place, minLat: '36', minLng: '-80', maxLat: '35', maxLng: '-81' },
      headers: creds,
    })

    expect(getPlaceVisitHistory.mock.calls[0][1].bounds).toBeUndefined()
  })

  test('passes radius and recentLimit when numeric', async () => {
    await req(app).get('/location-history/place', {
      query: { ...place, radius: '250', recentLimit: '5' },
      headers: creds,
    })

    expect(getPlaceVisitHistory.mock.calls[0][1]).toMatchObject({
      radius: 250,
      recentLimit: 5,
    })
  })

  test('omits a non-numeric radius', async () => {
    await req(app).get('/location-history/place', {
      query: { ...place, radius: 'wide' },
      headers: creds,
    })

    expect(getPlaceVisitHistory.mock.calls[0][1].radius).toBeUndefined()
  })

  test('502s opaquely when the upstream call fails', async () => {
    getPlaceVisitHistory.mockRejectedValueOnce(new Error('upstream 500 at /api?token=xyz'))

    const res = await req(app).get('/location-history/place', {
      query: place,
      headers: creds,
    })

    expect(res.status).toBe(502)
    expect(JSON.stringify(res.body)).not.toContain('token=xyz')
  })

  test('requires the integration credential headers', async () => {
    const res = await req(app).get('/location-history/place', { query: place })

    expect(res.status).toBe(400)
    expect(getPlaceVisitHistory).not.toHaveBeenCalled()
  })
})
