/**
 * Endpoint tests for the tile proxy.
 *
 * Tile routes are deliberately unauthenticated: a MapLibre raster/vector
 * source fetches them directly and can't attach our auth header. What they
 * must never do is leak a provider key, so several tests assert the key
 * appears in the upstream URL but never in the response.
 *
 * Data endpoints that happen to be served by Barrelman are not proxies and
 * live elsewhere — see transit / gbfs / isochrone controller tests.
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

const proxy = (await import('./proxy.controller')).default
const app = createTestApp(proxy)

const realFetch = globalThis.fetch
let fetchResponses: Response[] = []
let fetchError: Error | null = null
const fetchCalls: string[] = []

globalThis.fetch = mock(async (url: any) => {
  fetchCalls.push(String(url))
  if (fetchError) throw fetchError
  return fetchResponses.shift() ?? new Response(new Uint8Array([1, 2, 3]))
}) as any

afterAll(() => {
  globalThis.fetch = realFetch
})

function tileResponse() {
  return new Response(new Uint8Array([1, 2, 3]), {
    headers: { 'content-type': 'application/x-protobuf' },
  })
}

const barrelmanIntegration = {
  integrationId: 'barrelman',
  config: { host: 'https://barrelman.test', apiKey: 'barrelman-key' },
}

beforeEach(() => {
  resetAuth()
  fetchCalls.length = 0
  fetchResponses = []
  fetchError = null
  configuredIntegrations = [barrelmanIntegration]
})

describe('GET /proxy/loom/:service/geo/:z/:x/:y', () => {
  test('proxies the Loom tile with a day-long cache', async () => {
    fetchResponses = [tileResponse()]

    const res = await req(app).get('/proxy/loom/transit/geo/12/1170/1567')

    expect(res.status).toBe(200)
    expect(fetchCalls[0]).toBe(
      'https://loom.cs.uni-freiburg.de/tiles/transit/geo/12/1170/1567.mvt',
    )
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400')
    expect(res.headers.get('content-type')).toBe('application/x-protobuf')
  })

  test('is unauthenticated — map tile sources send no auth header', async () => {
    setAuthUser(null)
    fetchResponses = [tileResponse()]

    const res = await req(app).get('/proxy/loom/transit/geo/12/1170/1567')

    expect(res.status).toBe(200)
  })

  test('500s when the upstream tile fails', async () => {
    fetchResponses = [new Response('nope', { status: 502 })]

    const res = await req(app).get('/proxy/loom/transit/geo/12/1170/1567')

    expect(res.status).toBe(500)
  })

  test('500s when the fetch throws', async () => {
    fetchError = new Error('ECONNREFUSED')

    const res = await req(app).get('/proxy/loom/transit/geo/12/1170/1567')

    expect(res.status).toBe(500)
  })
})

describe('GET /proxy/mapillary/...', () => {
  const path = '/proxy/mapillary/mly1_public/2/14/4823/6160'

  test('501s when Mapillary is not configured', async () => {
    configuredIntegrations = []

    const res = await req(app).get(path)

    expect(res.status).toBe(501)
    expect(fetchCalls).toHaveLength(0)
  })

  test('proxies with the access token from the integration', async () => {
    configuredIntegrations = [
      { integrationId: 'mapillary', config: { accessToken: 'mly-token' } },
    ]
    fetchResponses = [tileResponse()]

    const res = await req(app).get(path)

    expect(res.status).toBe(200)
    expect(fetchCalls[0]).toContain('tiles.mapillary.com')
    expect(fetchCalls[0]).toContain('access_token=mly-token')
  })

  test('does not leak the token to the client', async () => {
    configuredIntegrations = [
      { integrationId: 'mapillary', config: { accessToken: 'mly-token' } },
    ]
    fetchResponses = [tileResponse()]

    const res = await req(app).get(path)

    expect(String(res.body)).not.toContain('mly-token')
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
  })

  test('forwards the upstream status on failure', async () => {
    configuredIntegrations = [
      { integrationId: 'mapillary', config: { accessToken: 'mly-token' } },
    ]
    fetchResponses = [new Response('rate limited', { status: 429 })]

    const res = await req(app).get(path)

    expect(res.status).toBe(429)
  })

  test('500s when the proxy throws', async () => {
    configuredIntegrations = [
      { integrationId: 'mapillary', config: { accessToken: 'mly-token' } },
    ]
    fetchError = new Error('socket hang up')

    const res = await req(app).get(path)

    expect(res.status).toBe(500)
  })
})

describe('GET /proxy/transitland/...', () => {
  test('routes tiles use the apiKey from the integration', async () => {
    configuredIntegrations = [
      { integrationId: 'transitland', config: { apiKey: 'tl-key' } },
    ]
    fetchResponses = [tileResponse()]

    const res = await req(app).get('/proxy/transitland/routes/12/1170/1567')

    expect(res.status).toBe(200)
    expect(fetchCalls[0]).toContain('/tiles/routes/tiles/12/1170/1567.pbf')
    expect(fetchCalls[0]).toContain('apikey=tl-key')
  })

  test('stop tiles hit the stops endpoint', async () => {
    configuredIntegrations = [
      { integrationId: 'transitland', config: { apiKey: 'tl-key' } },
    ]
    fetchResponses = [tileResponse()]

    await req(app).get('/proxy/transitland/stops/12/1170/1567')

    expect(fetchCalls[0]).toContain('/tiles/stops/tiles/12/1170/1567.pbf')
  })

  test('501s when Transitland is not configured', async () => {
    configuredIntegrations = []

    const res = await req(app).get('/proxy/transitland/routes/12/1170/1567')

    expect(res.status).toBe(501)
  })
})

describe('GET /proxy/barrelman/:source/:z/:x/:y', () => {
  test('proxies to the configured Martin host with the tile token', async () => {
    configuredIntegrations = [
      {
        integrationId: 'barrelman',
        config: { martinHost: 'https://martin.test', tileKey: 'tile-key' },
      },
    ]
    fetchResponses = [tileResponse()]

    const res = await req(app).get('/proxy/barrelman/geo_places/12/1170/1567')

    expect(res.status).toBe(200)
    expect(fetchCalls[0]).toContain('https://martin.test/geo_places/12/1170/1567')
    expect(fetchCalls[0]).toContain('token=tile-key')
  })

  test('falls back to MARTIN_HOST when the integration has none', async () => {
    configuredIntegrations = [{ integrationId: 'barrelman', config: {} }]
    process.env.MARTIN_HOST = 'https://martin-env.test'
    fetchResponses = [tileResponse()]

    await req(app).get('/proxy/barrelman/geo_places/12/1170/1567')

    expect(fetchCalls[0]).toContain('martin-env.test')
    delete process.env.MARTIN_HOST
  })

  test('omits the token when none is configured', async () => {
    configuredIntegrations = [
      { integrationId: 'barrelman', config: { martinHost: 'https://martin.test' } },
    ]
    fetchResponses = [tileResponse()]

    await req(app).get('/proxy/barrelman/geo_places/12/1170/1567')

    expect(fetchCalls[0]).not.toContain('token=')
  })

  test('preserves the upstream content type', async () => {
    configuredIntegrations = [
      { integrationId: 'barrelman', config: { martinHost: 'https://martin.test' } },
    ]
    fetchResponses = [
      new Response(new Uint8Array([1]), {
        headers: { 'content-type': 'application/vnd.mapbox-vector-tile' },
      }),
    ]

    const res = await req(app).get('/proxy/barrelman/geo_places/12/1170/1567')

    expect(res.headers.get('content-type')).toBe('application/vnd.mapbox-vector-tile')
  })

  test('forwards the upstream status on failure', async () => {
    configuredIntegrations = [
      { integrationId: 'barrelman', config: { martinHost: 'https://martin.test' } },
    ]
    fetchResponses = [new Response('gone', { status: 404 })]

    const res = await req(app).get('/proxy/barrelman/geo_places/12/1170/1567')

    expect(res.status).toBe(404)
  })
})
