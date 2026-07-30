/**
 * Endpoint tests for the isochrone controller.
 *
 * Two behaviours carry weight here. Local validation stops requests that are
 * expensive to discover upstream (a 40-contour transit fan-out) before they
 * cost a round trip; and Barrelman's own 4xx messages are forwarded intact,
 * because they name the offending parameter and its limit.
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

const isochrone = (await import('./isochrone.controller')).default
const app = createTestApp(isochrone)

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

const origin = { lat: '35.7796', lng: '-78.6382' }

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

describe('routing', () => {
  test('is served off /isochrone, not under the tile proxy', async () => {
    fetchResponses = [jsonResponse({ isochrones: { features: [] } })]

    const res = await req(app).get('/isochrone', { query: origin })

    expect(res.status).toBe(200)
    expect(fetchCalls[0]).toContain('https://barrelman.test/isochrone')
  })

  test('is no longer reachable under /proxy', async () => {
    const res = await req(app).get('/proxy/isochrone', { query: origin })

    expect(res.status).toBe(404)
  })

  test('rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).get('/isochrone', { query: origin })

    expect(res.status).toBe(401)
    expect(fetchCalls).toHaveLength(0)
  })
})

describe('Barrelman passthrough', () => {
  test('forwards the origin, mode and durations upstream', async () => {
    fetchResponses = [jsonResponse({ isochrones: { features: [] } })]

    const res = await req(app).get('/isochrone', {
      query: { ...origin, mode: 'bike', durations: '300,600,900' },
    })

    expect(res.status).toBe(200)
    expect(fetchCalls[0]).toContain('mode=bike')
    expect(fetchCalls[0]).toContain('durations=300%2C600%2C900')
  })

  test('is never cached — transit contours depend on the departure time', async () => {
    fetchResponses = [jsonResponse({})]

    const res = await req(app).get('/isochrone', { query: origin })

    expect(res.headers.get('cache-control')).toBe('no-cache')
  })

  test('501s when Barrelman is not configured', async () => {
    configuredIntegrations = []

    const res = await req(app).get('/isochrone', { query: origin })

    expect(res.status).toBe(501)
    expect(fetchCalls).toHaveLength(0)
  })

  test('never echoes the Barrelman API key to the client', async () => {
    fetchResponses = [jsonResponse({ isochrones: { features: [] } })]

    const res = await req(app).get('/isochrone', { query: origin })

    expect(JSON.stringify(res.body)).not.toContain('barrelman-key')
  })
})

describe('local validation — no upstream round trip', () => {
  const rejected: Array<[string, Record<string, string>]> = [
    ['a missing origin', {}],
    ['a non-numeric origin', { lat: 'north', lng: '-78.6382' }],
    ['an out-of-range latitude', { lat: '91', lng: '-78.6382' }],
    ['an out-of-range longitude', { ...origin, lng: '181' }],
    ['an unsupported mode', { ...origin, mode: 'teleport' }],
    // Barrelman accepts aliases; this endpoint deliberately does not.
    ['a mode alias', { ...origin, mode: 'foot' }],
    ['a negative duration', { ...origin, durations: '-60' }],
    ['a non-numeric duration', { ...origin, durations: 'soon' }],
    ['more than 8 contours', { ...origin, durations: '1,2,3,4,5,6,7,8,9' }],
    // 3h is the street ceiling…
    ['a street duration past the limit', { ...origin, durations: '10801' }],
    // …but transit tops out at 2h, so the same value is too long there.
    ['a transit duration past the limit', { ...origin, mode: 'transit', durations: '7201' }],
  ]

  for (const [label, query] of rejected) {
    test(`400s on ${label}`, async () => {
      const res = await req(app).get('/isochrone', { query })

      expect(res.status).toBe(400)
      expect(res.body.error).toBeString()
      expect(fetchCalls).toHaveLength(0)
    })
  }

  test('accepts a 3h street contour, which transit would reject', async () => {
    fetchResponses = [jsonResponse({})]

    const res = await req(app).get('/isochrone', {
      query: { ...origin, mode: 'car', durations: '10800' },
    })

    expect(res.status).toBe(200)
  })
})

describe('upstream errors', () => {
  test("forwards Barrelman's validation message rather than a generic error", async () => {
    fetchResponses = [
      new Response(JSON.stringify({ error: 'Point not found in graph' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    ]

    const res = await req(app).get('/isochrone', { query: origin })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Point not found in graph')
  })

  test('still replaces a non-JSON upstream error body', async () => {
    fetchResponses = [
      new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    ]

    const res = await req(app).get('/isochrone', { query: origin })

    expect(res.status).toBe(502)
    expect(res.body).toEqual({ error: 'Upstream error: 502' })
    expect(JSON.stringify(res.body)).not.toContain('<html>')
  })
})

describe('GET /isochrone/modes', () => {
  test('is cached for an hour and needs no origin', async () => {
    fetchResponses = [jsonResponse({ modes: [] })]

    const res = await req(app).get('/isochrone/modes')

    expect(res.status).toBe(200)
    expect(fetchCalls[0]).toContain('https://barrelman.test/isochrone/modes')
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
  })

  test('rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).get('/isochrone/modes')

    expect(res.status).toBe(401)
  })
})
