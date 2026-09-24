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
import { martinTileCache, portolanTileCache } from '../lib/tile-cache'

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
/** Headers per call, so auth can be asserted as well as the URL. */
const fetchHeaders: Record<string, string>[] = []
/** Whether each call asked Bun to leave the body compressed. */
const fetchDecompress: (boolean | undefined)[] = []

globalThis.fetch = mock(async (url: any, init?: any) => {
  fetchCalls.push(String(url))
  fetchHeaders.push({ ...(init?.headers ?? {}) })
  fetchDecompress.push(init?.decompress)
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
  portolanTileCache.clear()
  martinTileCache.clear()
  fetchCalls.length = 0
  fetchHeaders.length = 0
  fetchDecompress.length = 0
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

  // Martin answers in 1-6 ms; the rest of the ~2 s a client waited was the trip
  // to the Barrelman host. These tiles were forwarded uncached, so every
  // basemap tile for every user paid it.
  test('serves a repeat tile from cache instead of re-fetching upstream', async () => {
    configuredIntegrations = [
      { integrationId: 'barrelman', config: { host: 'http://barrelman.test', apiKey: 'k' } },
    ]
    fetchResponses = [tileResponse()]

    const first = await req(app).get('/proxy/barrelman/basemap/12/1170/1567')
    expect(first.headers.get('X-Cache')).toBe('MISS')
    expect(fetchCalls.length).toBe(1)

    const second = await req(app).get('/proxy/barrelman/basemap/12/1170/1567')
    expect(second.headers.get('X-Cache')).toBe('HIT')
    // the whole point: no second trip upstream
    expect(fetchCalls.length).toBe(1)
    expect(second.status).toBe(200)
  })

  test('caches per tile, so a different tile still goes upstream', async () => {
    configuredIntegrations = [
      { integrationId: 'barrelman', config: { host: 'http://barrelman.test', apiKey: 'k' } },
    ]
    fetchResponses = [tileResponse(), tileResponse()]

    await req(app).get('/proxy/barrelman/basemap/12/1170/1567')
    await req(app).get('/proxy/barrelman/basemap/12/1170/1568')
    expect(fetchCalls.length).toBe(2)
  })

  // A 404 is a stable answer; a 5xx is the upstream having a bad moment, and
  // remembering it for an hour would turn a blip into an outage.
  test('caches a 404 but never a 5xx', async () => {
    configuredIntegrations = [
      { integrationId: 'barrelman', config: { host: 'http://barrelman.test', apiKey: 'k' } },
    ]
    fetchResponses = [
      new Response('nope', { status: 404 }),
      new Response('boom', { status: 503 }),
      new Response('boom', { status: 503 }),
    ]

    await req(app).get('/proxy/barrelman/basemap/9/1/1')
    const cached404 = await req(app).get('/proxy/barrelman/basemap/9/1/1')
    expect(cached404.headers.get('X-Cache')).toBe('HIT')
    expect(cached404.status).toBe(404)
    expect(fetchCalls.length).toBe(1)

    await req(app).get('/proxy/barrelman/basemap/9/2/2')
    await req(app).get('/proxy/barrelman/basemap/9/2/2')
    // both 503s went upstream — the failure was not remembered
    expect(fetchCalls.length).toBe(3)
  })

  /**
   * Barrelman gzips its tiles and `fetch()` silently decompresses them, so
   * without this every tile was handed on at roughly 1.6x the size Barrelman
   * produced, with no encoding header — and the CDN re-compressed it for the
   * browser, hiding the cost on the one hop that crosses a network.
   */
  test('gzips the tile and says so when the caller accepts it', async () => {
    configuredIntegrations = [
      { integrationId: 'barrelman', config: { host: 'http://barrelman.test', apiKey: 'k' } },
    ]
    const tile = new Uint8Array(4096).fill(0x42)
    fetchResponses = [
      new Response(tile, { headers: { 'content-type': 'application/x-protobuf' } }),
    ]

    const res = await app.handle(
      new Request('http://localhost/proxy/barrelman/basemap/14/4825/6156', {
        headers: { 'accept-encoding': 'gzip, deflate, br' },
      }),
    )

    expect(res.headers.get('content-encoding')).toBe('gzip')
    expect(res.headers.get('vary')).toBe('Accept-Encoding')

    const sent = new Uint8Array(await res.arrayBuffer())
    expect(sent.byteLength).toBeLessThan(tile.byteLength)
    expect(new Uint8Array(Bun.gunzipSync(sent))).toEqual(tile)
  })

  /**
   * The gzip Barrelman sent is handed on untouched. Unzipping it and zipping
   * it again cost ~10 ms of synchronous CPU per dense tile, on the thread that
   * serves every request, to produce bytes Barrelman had already produced.
   */
  test('passes upstream gzip through without re-zipping it', async () => {
    configuredIntegrations = [
      { integrationId: 'barrelman', config: { host: 'http://barrelman.test', apiKey: 'k' } },
    ]
    const upstream = new Uint8Array(Bun.gzipSync(new Uint8Array(4096).fill(0x42)))
    fetchResponses = [
      new Response(upstream, {
        headers: { 'content-type': 'application/x-protobuf', 'content-encoding': 'gzip' },
      }),
    ]

    const res = await app.handle(
      new Request('http://localhost/proxy/barrelman/basemap/14/7/7', {
        headers: { 'accept-encoding': 'gzip' },
      }),
    )

    expect(fetchDecompress[0]).toBe(false)
    expect(fetchHeaders[0]['Accept-Encoding']).toBe('gzip')
    expect(res.headers.get('content-encoding')).toBe('gzip')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(upstream)
  })

  /**
   * Bun's fetch reports `content-encoding: gzip` even when it has unzipped
   * the body. Trusting that header would send plain bytes labelled as gzip —
   * a corrupt tile for every client — so the bytes themselves decide.
   */
  test('re-zips a plain body even when the header claims gzip', async () => {
    configuredIntegrations = [
      { integrationId: 'barrelman', config: { host: 'http://barrelman.test', apiKey: 'k' } },
    ]
    const tile = new Uint8Array(2048).fill(0x1a)
    fetchResponses = [
      new Response(tile, {
        headers: { 'content-type': 'application/x-protobuf', 'content-encoding': 'gzip' },
      }),
    ]

    const res = await app.handle(
      new Request('http://localhost/proxy/barrelman/basemap/14/8/8', {
        headers: { 'accept-encoding': 'gzip' },
      }),
    )

    const sent = new Uint8Array(await res.arrayBuffer())
    expect(new Uint8Array(Bun.gunzipSync(sent))).toEqual(tile)
  })

  test('sends plain bytes to a caller that cannot read gzip', async () => {
    configuredIntegrations = [
      { integrationId: 'barrelman', config: { host: 'http://barrelman.test', apiKey: 'k' } },
    ]
    const tile = new Uint8Array([1, 2, 3, 4, 5])
    fetchResponses = [
      new Response(tile, { headers: { 'content-type': 'application/x-protobuf' } }),
    ]

    const res = await app.handle(
      new Request('http://localhost/proxy/barrelman/basemap/14/1/1', {
        headers: { 'accept-encoding': 'identity' },
      }),
    )

    expect(res.headers.get('content-encoding')).toBeNull()
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(tile)
  })

  /** The cache holds the gzipped bytes, so a hit must still decode. */
  test('a cached hit is served gzipped too', async () => {
    configuredIntegrations = [
      { integrationId: 'barrelman', config: { host: 'http://barrelman.test', apiKey: 'k' } },
    ]
    const tile = new Uint8Array(2048).fill(0x7)
    fetchResponses = [
      new Response(tile, { headers: { 'content-type': 'application/x-protobuf' } }),
    ]

    const url = 'http://localhost/proxy/barrelman/basemap/14/9/9'
    const opts = { headers: { 'accept-encoding': 'gzip' } }
    const first = await app.handle(new Request(url, opts))
    expect(first.headers.get('X-Cache')).toBe('MISS')

    const second = await app.handle(new Request(url, opts))
    expect(second.headers.get('X-Cache')).toBe('HIT')
    expect(second.headers.get('content-encoding')).toBe('gzip')
    expect(fetchCalls.length).toBe(1)

    const sent = new Uint8Array(await second.arrayBuffer())
    expect(new Uint8Array(Bun.gunzipSync(sent))).toEqual(tile)
  })

  /** And a hit still unzips for the caller that cannot read gzip. */
  test('a cached hit unzips for a caller that cannot read gzip', async () => {
    configuredIntegrations = [
      { integrationId: 'barrelman', config: { host: 'http://barrelman.test', apiKey: 'k' } },
    ]
    const tile = new Uint8Array([9, 8, 7, 6])
    fetchResponses = [
      new Response(tile, { headers: { 'content-type': 'application/x-protobuf' } }),
    ]

    const url = 'http://localhost/proxy/barrelman/basemap/14/3/3'
    await app.handle(new Request(url, { headers: { 'accept-encoding': 'gzip' } }))
    const hit = await app.handle(
      new Request(url, { headers: { 'accept-encoding': 'identity' } }),
    )

    expect(hit.headers.get('X-Cache')).toBe('HIT')
    expect(hit.headers.get('content-encoding')).toBeNull()
    expect(new Uint8Array(await hit.arrayBuffer())).toEqual(tile)
  })

  test('tiles carry stale-while-revalidate so an expiry is not a cold wait', async () => {
    configuredIntegrations = [
      { integrationId: 'barrelman', config: { host: 'http://barrelman.test', apiKey: 'k' } },
    ]
    fetchResponses = [tileResponse()]

    const res = await req(app).get('/proxy/barrelman/basemap/12/5/5')
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=86400, stale-while-revalidate=604800',
    )
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

/**
 * These asserted a `martinHost` config field and a bare `/{source}/…` path, and
 * passed — because the mock supplied that field too. Neither existed: Barrelman
 * serves tiles at `/tiles/*` and `BarrelmanConfig` carries `host`, so in
 * production the lookup returned undefined and every tile went to the localhost
 * default. Nothing about the basemap drew. Tests now name the same fields the
 * integration actually stores.
 */
describe('GET /proxy/barrelman/:source/:z/:x/:y', () => {
  test('proxies to the Barrelman host under /tiles', async () => {
    configuredIntegrations = [
      {
        integrationId: 'barrelman',
        config: { host: 'https://barrelman.test' },
      },
    ]
    fetchResponses = [tileResponse()]

    const res = await req(app).get('/proxy/barrelman/geo_places/12/1170/1567')

    expect(res.status).toBe(200)
    expect(fetchCalls[0]).toContain('https://barrelman.test/tiles/geo_places/12/1170/1567')
  })

  test('sends the integration apiKey as a bearer, like every other Barrelman call', async () => {
    fetchResponses = [tileResponse()]

    await req(app).get('/proxy/barrelman/geo_places/12/1170/1567')

    expect(fetchHeaders[0].Authorization).toBe('Bearer barrelman-key')
  })

  test('falls back to MARTIN_HOST when the integration has no host', async () => {
    configuredIntegrations = [{ integrationId: 'barrelman', config: {} }]
    process.env.MARTIN_HOST = 'https://martin-env.test'
    fetchResponses = [tileResponse()]

    await req(app).get('/proxy/barrelman/geo_places/12/1170/1567')

    expect(fetchCalls[0]).toContain('martin-env.test')
    delete process.env.MARTIN_HOST
  })

  test('answers 501 rather than guessing when no host is configured at all', async () => {
    configuredIntegrations = [{ integrationId: 'barrelman', config: {} }]

    const res = await req(app).get('/proxy/barrelman/geo_places/12/1170/1567')

    expect(res.status).toBe(501)
    expect(fetchCalls).toEqual([])
  })

  test('preserves the upstream content type', async () => {
    fetchResponses = [
      new Response(new Uint8Array([1]), {
        headers: { 'content-type': 'application/vnd.mapbox-vector-tile' },
      }),
    ]

    const res = await req(app).get('/proxy/barrelman/geo_places/12/1170/1567')

    expect(res.headers.get('content-type')).toBe('application/vnd.mapbox-vector-tile')
  })

  test('forwards the upstream status on failure', async () => {
    fetchResponses = [new Response('gone', { status: 404 })]

    const res = await req(app).get('/proxy/barrelman/geo_places/12/1170/1567')

    expect(res.status).toBe(404)
  })
})

/**
 * Portolan tiles are cached IN THE SERVER, not just in the browser.
 *
 * Parchment proxies them, so every user's map traffic reaches barrelman
 * from one address — and barrelman's per-address limit is sized for API
 * calls, not for a viewport's worth of tiles. Forwarding each request ran
 * normal map viewing into a steady stream of 429s. These assert the proxy
 * asks upstream once and answers from memory after that.
 */
describe('GET /proxy/portolan/* — server-side caching', () => {
  test('the second request never reaches barrelman', async () => {
    fetchResponses = [tileResponse()]

    const first = await req(app).get('/proxy/portolan/nyc/14/4825/6168.mvt')
    expect(first.status).toBe(200)
    expect(first.headers.get('x-cache')).toBe('MISS')
    expect(fetchCalls.length).toBe(1)

    const second = await req(app).get('/proxy/portolan/nyc/14/4825/6168.mvt')
    expect(second.status).toBe(200)
    expect(second.headers.get('x-cache')).toBe('HIT')
    expect(fetchCalls.length).toBe(1) // no second upstream call
    // the harness decodes the body as text; the bytes survive the round trip
    expect(String(second.body)).toBe(String(first.body))
    expect(String(second.body).length).toBeGreaterThan(0)
  })

  test('an empty tile is cached, which is most of a viewport', async () => {
    fetchResponses = [new Response(null, { status: 204 })]

    const first = await req(app).get('/proxy/portolan/nyc/14/1/1.mvt')
    expect(first.status).toBe(204)
    expect(fetchCalls.length).toBe(1)

    const second = await req(app).get('/proxy/portolan/nyc/14/1/1.mvt')
    expect(second.status).toBe(204)
    expect(second.headers.get('x-cache')).toBe('HIT')
    expect(fetchCalls.length).toBe(1)
  })

  test('a 404 is cached — the client asks again on every load', async () => {
    // the bus-only feeds have no routes.json at all, and that request
    // repeats forever; barrelman boxes an address that keeps being refused
    fetchResponses = [new Response('nope', { status: 404 })]

    const first = await req(app).get('/proxy/portolan/mta-bus/routes.json')
    expect(first.status).toBe(404)
    expect(fetchCalls.length).toBe(1)

    const second = await req(app).get('/proxy/portolan/mta-bus/routes.json')
    expect(second.status).toBe(404)
    expect(second.headers.get('x-cache')).toBe('HIT')
    expect(fetchCalls.length).toBe(1)
  })

  test('an upstream fault is NOT cached', async () => {
    // a 500 is a moment, not an answer — caching it would extend an
    // outage past the end of the outage
    fetchResponses = [new Response('boom', { status: 500 }), tileResponse()]

    const first = await req(app).get('/proxy/portolan/nyc/14/9/9.mvt')
    expect(first.status).toBe(500)

    const second = await req(app).get('/proxy/portolan/nyc/14/9/9.mvt')
    expect(second.status).toBe(200)
    expect(fetchCalls.length).toBe(2) // it asked again
  })

  test('different tiles are different entries', async () => {
    fetchResponses = [tileResponse(), tileResponse()]
    await req(app).get('/proxy/portolan/nyc/14/1/2.mvt')
    await req(app).get('/proxy/portolan/nyc/14/1/3.mvt')
    expect(fetchCalls.length).toBe(2)
    await req(app).get('/proxy/portolan/nyc/14/1/2.mvt')
    expect(fetchCalls.length).toBe(2)
  })

  test('a cached tile keeps its content type and browser TTL', async () => {
    fetchResponses = [tileResponse()]
    await req(app).get('/proxy/portolan/nyc/14/5/5.mvt')
    const hit = await req(app).get('/proxy/portolan/nyc/14/5/5.mvt')
    expect(hit.headers.get('content-type')).toContain('protobuf')
    expect(hit.headers.get('cache-control')).toContain('max-age=3600')
  })
})
