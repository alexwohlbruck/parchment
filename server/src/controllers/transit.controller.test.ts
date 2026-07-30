/**
 * Endpoint tests for the transit controller.
 *
 * Every route requires a session — anonymous enumeration of live vehicle
 * positions and route topology is exactly what that guard exists to prevent —
 * and the Barrelman API key must never reach the client.
 */

import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test'
import { authMockModule, setAuthUser, resetAuth } from '../test/auth-mock'
import { createTestApp, req } from '../test/app'

let configuredIntegrations: any[] = []

mock.module('../services/integrations', () => ({
  integrationManager: {
    getConfiguredIntegrations: () => configuredIntegrations,
  },
}))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

mock.module('../middleware/auth.middleware', () => authMockModule())

const transit = (await import('./transit.controller')).default
const app = createTestApp(transit)

const realFetch = globalThis.fetch
let fetchResponses: Response[] = []
const fetchCalls: string[] = []

globalThis.fetch = mock(async (url: any) => {
  fetchCalls.push(String(url))
  return fetchResponses.shift() ?? new Response('{}')
}) as any

afterAll(() => {
  globalThis.fetch = realFetch
})

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  resetAuth()
  fetchCalls.length = 0
  fetchResponses = []
  configuredIntegrations = [
    {
      integrationId: 'barrelman',
      config: { host: 'https://barrelman.test', apiKey: 'barrelman-key' },
    },
  ]
})

describe('authentication', () => {
  const routes = [
    '/transit/vehicles',
    '/transit/shapes',
    '/transit/route-vehicles',
    '/transit/trip-stops',
    '/transit/route-detail',
    '/transit/departures',
    '/transit/bikes-allowed',
    '/transit/nearest-entrance',
    '/transit/station/feed-1/stop-1',
  ]

  for (const path of routes) {
    test(`GET ${path} rejects an unauthenticated caller`, async () => {
      setAuthUser(null)

      const res = await req(app).get(path)

      expect(res.status).toBe(401)
      expect(fetchCalls).toHaveLength(0)
    })
  }
})

describe('routing', () => {
  test('is served off /transit, not under the tile proxy', async () => {
    fetchResponses = [jsonResponse({ vehicles: [] })]

    const res = await req(app).get('/transit/vehicles')

    expect(res.status).toBe(200)
  })

  test('is no longer reachable under /proxy', async () => {
    const res = await req(app).get('/proxy/transit/vehicles')

    expect(res.status).toBe(404)
  })
})

describe('Barrelman passthrough', () => {
  test('forwards query params and the bearer key upstream', async () => {
    fetchResponses = [jsonResponse({ vehicles: [] })]

    const res = await req(app).get('/transit/vehicles', {
      query: { feedId: 'feed-1', bbox: '-81,35,-80,36' },
    })

    expect(res.status).toBe(200)
    expect(fetchCalls[0]).toContain('https://barrelman.test/transit/vehicles')
    expect(fetchCalls[0]).toContain('feedId=feed-1')
  })

  test('drops empty and null query params', async () => {
    fetchResponses = [jsonResponse({})]

    await req(app).get('/transit/vehicles', {
      query: { feedId: 'feed-1', bbox: '' },
    })

    expect(fetchCalls[0]).not.toContain('bbox=')
  })

  test('501s when Barrelman is not configured', async () => {
    configuredIntegrations = []

    const res = await req(app).get('/transit/vehicles')

    expect(res.status).toBe(501)
    expect(res.body.error).toBe('Barrelman not configured')
    expect(fetchCalls).toHaveLength(0)
  })

  test('replaces an upstream HTML error with clean JSON', async () => {
    fetchResponses = [
      new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    ]

    const res = await req(app).get('/transit/vehicles')

    expect(res.status).toBe(502)
    expect(res.body).toEqual({ error: 'Upstream error: 502' })
    expect(String(res.body)).not.toContain('<html>')
  })

  test('never echoes the Barrelman API key to the client', async () => {
    fetchResponses = [jsonResponse({ ok: true })]

    const res = await req(app).get('/transit/vehicles')

    expect(JSON.stringify(res.body)).not.toContain('barrelman-key')
  })

  test('station detail encodes the feed and stop ids into the path', async () => {
    fetchResponses = [jsonResponse({})]

    await req(app).get('/transit/station/feed%2F1/stop%201')

    expect(fetchCalls[0]).toContain('/transit/station/feed%2F1/stop%201')
  })
})

describe('caching', () => {
  const cases: Array<[string, string]> = [
    // Live positions — a stale answer is worse than no answer.
    ['/transit/vehicles', 'no-cache'],
    ['/transit/route-vehicles', 'no-cache'],
    ['/transit/trip-stops', 'no-cache'],
    // Topology only changes on a feed import.
    ['/transit/shapes', 'public, max-age=86400'],
    ['/transit/route-detail', 'public, max-age=3600'],
    ['/transit/bikes-allowed', 'public, max-age=3600'],
    ['/transit/nearest-entrance', 'public, max-age=3600'],
    // Departures move, but not second to second.
    ['/transit/departures', 'public, max-age=30'],
  ]

  for (const [path, expected] of cases) {
    test(`${path} is cached "${expected}"`, async () => {
      fetchResponses = [jsonResponse({})]

      const res = await req(app).get(path)

      expect(res.headers.get('cache-control')).toBe(expected)
    })
  }
})
