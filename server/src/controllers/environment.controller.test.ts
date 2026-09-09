/**
 * Endpoint tests for the environment overlays controller.
 *
 * Two shapes matter here. The raster tile route is deliberately public — a
 * MapLibre raster source can't attach our auth header — and must degrade to a
 * transparent PNG rather than an error, so a failing upstream never breaks the
 * map. The GeoJSON routes are authenticated and degrade to an empty
 * FeatureCollection for the same reason.
 *
 * Upstream calls go through global fetch, which is stubbed per test.
 */

import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test'
import { authMockModule, setAuthUser, resetAuth } from '../test/auth-mock'
import { createTestApp, req } from '../test/app'

const EMPTY_FC = { type: 'FeatureCollection', features: [] }

/** Faithful-enough stand-in; the real parser has its own tests in lib/. */
const parseBbox = mock((s: string) => {
  const parts = s.split(',').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
  const [west, south, east, north] = parts
  return { west, south, east, north }
})

/** Features the next parseFirmsCsv call yields. */
let firmsFeatures: any[] = []
const parseFirmsCsv = mock((_csv: string) => ({
  type: 'FeatureCollection',
  features: firmsFeatures,
}))

mock.module('../lib/wildfire', () => ({ parseBbox, parseFirmsCsv, EMPTY_FC }))

let configuredIntegrations: any[] = [
  { integrationId: 'firms', config: { apiKey: 'firms-key' } },
]
mock.module('../services/integrations', () => ({
  integrationManager: {
    getConfiguredIntegrations: () => configuredIntegrations,
  },
}))

const getStationsGeoJson = mock(async (_bbox: any) => ({
  type: 'FeatureCollection',
  features: [{ id: 'station-1' }],
}))
mock.module('../services/air-quality.service', () => ({ getStationsGeoJson }))

mock.module('../middleware/auth.middleware', () => authMockModule())

const environment = (await import('./environment.controller')).default
const app = createTestApp(environment)

const realFetch = globalThis.fetch
/** Responses handed to successive fetch calls. */
let fetchResponses: Response[] = []
let fetchError: Error | null = null
const fetchCalls: string[] = []

globalThis.fetch = mock(async (url: any) => {
  fetchCalls.push(String(url))
  if (fetchError) throw fetchError
  return (
    fetchResponses.shift() ??
    new Response('{}', { headers: { 'content-type': 'application/json' } })
  )
}) as any

afterAll(() => {
  globalThis.fetch = realFetch
})

function pngResponse() {
  return new Response(new Uint8Array([1, 2, 3]), {
    headers: { 'content-type': 'image/png' },
  })
}

const BBOX = '-81,35,-80,36'

beforeEach(() => {
  resetAuth()
  fetchCalls.length = 0
  fetchResponses = []
  fetchError = null
  firmsFeatures = []
  configuredIntegrations = [{ integrationId: 'firms', config: { apiKey: 'firms-key' } }]
  parseBbox.mockClear()
  parseFirmsCsv.mockClear()
  getStationsGeoJson.mockClear()
  getStationsGeoJson.mockImplementation(async () => ({
    type: 'FeatureCollection',
    features: [{ id: 'station-1' }],
  }))
})

describe('GET /environment/tiles/aqi/:z/:x/:y', () => {
  test('is public — raster sources cannot send an auth header', async () => {
    setAuthUser(null)
    fetchResponses = [pngResponse()]

    const res = await req(app).get('/environment/tiles/aqi/5/10/12')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
  })

  test('requests the CAMS PM2.5 layer for the tile', async () => {
    fetchResponses = [pngResponse()]

    await req(app).get('/environment/tiles/aqi/5/10/12')

    expect(fetchCalls[0]).toContain('eccharts.ecmwf.int')
    expect(fetchCalls[0]).toContain('layers=composition_pm2p5')
    expect(fetchCalls[0]).toContain('crs=EPSG:3857')
  })

  test('converts the XYZ tile to EPSG:3857 bounds', async () => {
    fetchResponses = [pngResponse()]

    // z=0/x=0/y=0 is the whole world: ±20037508.34 on both axes.
    await req(app).get('/environment/tiles/aqi/0/0/0')

    const bbox = decodeURIComponent(fetchCalls[0]).match(/bbox=([^&]+)/)![1]
    const [minX, minY, maxX, maxY] = bbox.split(',').map(Number)
    expect(minX).toBeCloseTo(-20037508.34, 0)
    expect(maxX).toBeCloseTo(20037508.34, 0)
    expect(minY).toBeCloseTo(-20037508.34, 0)
    expect(maxY).toBeCloseTo(20037508.34, 0)
  })

  test('caches tiles for 30 minutes', async () => {
    fetchResponses = [pngResponse()]

    const res = await req(app).get('/environment/tiles/aqi/5/10/12')

    expect(res.headers.get('cache-control')).toBe('public, max-age=1800')
  })

  test('serves a transparent PNG when upstream errors', async () => {
    fetchError = new Error('ECONNRESET')

    const res = await req(app).get('/environment/tiles/aqi/5/10/12')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
  })

  test('serves a transparent PNG on a non-image response', async () => {
    fetchResponses = [
      new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } }),
    ]

    const res = await req(app).get('/environment/tiles/aqi/5/10/12')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
  })

  test('serves a transparent PNG on an upstream non-200', async () => {
    fetchResponses = [new Response('nope', { status: 500 })]

    const res = await req(app).get('/environment/tiles/aqi/5/10/12')

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
  })

  test('422s on non-numeric tile coordinates', async () => {
    const res = await req(app).get('/environment/tiles/aqi/a/b/c')

    expect(res.status).toBe(422)
  })
})

describe('authenticated overlay routes', () => {
  const routes = [
    '/environment/air-quality',
    '/environment/wildfire/hotspots',
    '/environment/wildfire/perimeters',
    '/environment/wildfire/smoke',
  ]

  for (const path of routes) {
    test(`GET ${path} rejects an unauthenticated caller`, async () => {
      setAuthUser(null)

      const res = await req(app).get(path, { query: { bbox: BBOX } })

      expect(res.status).toBe(401)
    })

    test(`GET ${path} returns an empty FeatureCollection for a bad bbox`, async () => {
      const res = await req(app).get(path, { query: { bbox: 'garbage' } })

      expect(res.status).toBe(200)
      expect(res.body).toEqual(EMPTY_FC)
    })

    test(`GET ${path} 422s without a bbox`, async () => {
      const res = await req(app).get(path)

      expect(res.status).toBe(422)
    })
  }
})

describe('GET /environment/air-quality', () => {
  test('returns OpenAQ stations for the viewport', async () => {
    const res = await req(app).get('/environment/air-quality', {
      query: { bbox: BBOX },
    })

    expect(res.status).toBe(200)
    expect(res.body.features).toHaveLength(1)
    expect(getStationsGeoJson).toHaveBeenCalledWith({
      west: -81,
      south: 35,
      east: -80,
      north: 36,
    })
  })

  test('is cacheable for 5 minutes', async () => {
    const res = await req(app).get('/environment/air-quality', {
      query: { bbox: BBOX },
    })

    expect(res.headers.get('cache-control')).toBe('public, max-age=300')
  })
})

describe('GET /environment/wildfire/hotspots', () => {
  function csvResponse() {
    return new Response('lat,lon\n1,2', { headers: { 'content-type': 'text/csv' } })
  }

  test('returns an empty collection when FIRMS is not configured', async () => {
    configuredIntegrations = []

    const res = await req(app).get('/environment/wildfire/hotspots', {
      query: { bbox: BBOX },
    })

    expect(res.body).toEqual(EMPTY_FC)
    expect(fetchCalls).toHaveLength(0)
  })

  test('queries all four VIIRS/MODIS feeds', async () => {
    fetchResponses = [csvResponse(), csvResponse(), csvResponse(), csvResponse()]

    await req(app).get('/environment/wildfire/hotspots', { query: { bbox: BBOX } })

    expect(fetchCalls).toHaveLength(4)
    expect(fetchCalls.join(' ')).toContain('VIIRS_NOAA20_NRT')
    expect(fetchCalls.join(' ')).toContain('MODIS_NRT')
  })

  test('keeps the API key server-side in the upstream URL only', async () => {
    fetchResponses = [csvResponse(), csvResponse(), csvResponse(), csvResponse()]

    const res = await req(app).get('/environment/wildfire/hotspots', {
      query: { bbox: BBOX },
    })

    expect(fetchCalls[0]).toContain('firms-key')
    expect(JSON.stringify(res.body)).not.toContain('firms-key')
  })

  test('defaults to a 1-day window', async () => {
    fetchResponses = [csvResponse(), csvResponse(), csvResponse(), csvResponse()]

    await req(app).get('/environment/wildfire/hotspots', { query: { bbox: BBOX } })

    expect(fetchCalls[0]).toMatch(/\/1$/)
  })

  test('clamps the day window to 10', async () => {
    fetchResponses = [csvResponse(), csvResponse(), csvResponse(), csvResponse()]

    await req(app).get('/environment/wildfire/hotspots', {
      query: { bbox: BBOX, days: '99' },
    })

    expect(fetchCalls[0]).toMatch(/\/10$/)
  })

  test('clamps a zero or negative day window up to 1', async () => {
    fetchResponses = [csvResponse(), csvResponse(), csvResponse(), csvResponse()]

    await req(app).get('/environment/wildfire/hotspots', {
      query: { bbox: BBOX, days: '0' },
    })

    expect(fetchCalls[0]).toMatch(/\/1$/)
  })

  test('drops VIIRS low-confidence detections', async () => {
    firmsFeatures = [
      { properties: { confidence: 'l', frp: 10 } },
      { properties: { confidence: 'h', frp: 20 } },
    ]
    fetchResponses = [csvResponse()]

    const res = await req(app).get('/environment/wildfire/hotspots', {
      query: { bbox: BBOX },
    })

    const confidences = res.body.features.map((f: any) => f.properties.confidence)
    expect(confidences).not.toContain('l')
    expect(confidences).toContain('h')
  })

  test('drops MODIS detections below 50% confidence', async () => {
    firmsFeatures = [
      { properties: { confidence: '20', frp: 10 } },
      { properties: { confidence: '80', frp: 20 } },
    ]
    fetchResponses = [csvResponse()]

    const res = await req(app).get('/environment/wildfire/hotspots', {
      query: { bbox: BBOX },
    })

    const confidences = res.body.features.map((f: any) => f.properties.confidence)
    expect(confidences).toEqual(expect.arrayContaining(['80']))
    expect(confidences).not.toContain('20')
  })

  test('keeps detections whose confidence is not a number', async () => {
    // 'n' is VIIRS nominal — neither the 'l' drop nor the numeric threshold
    // applies, so it survives. All four feeds parse to the same fixture here,
    // hence four features rather than one.
    firmsFeatures = [{ properties: { confidence: 'n', frp: 10 } }]
    fetchResponses = [csvResponse()]

    const res = await req(app).get('/environment/wildfire/hotspots', {
      query: { bbox: BBOX },
    })

    expect(res.body.features.length).toBeGreaterThan(0)
    expect(
      res.body.features.every((f: any) => f.properties.confidence === 'n'),
    ).toBe(true)
  })

  test('caps at 5000 features, keeping the highest fire radiative power', async () => {
    firmsFeatures = Array.from({ length: 6000 }, (_, i) => ({
      properties: { confidence: 'h', frp: i },
    }))
    fetchResponses = [csvResponse()]

    const res = await req(app).get('/environment/wildfire/hotspots', {
      query: { bbox: BBOX },
    })

    expect(res.body.features).toHaveLength(5000)
    expect(res.body.features[0].properties.frp).toBe(5999)
  })

  test('a failing feed contributes nothing without failing the request', async () => {
    firmsFeatures = [{ properties: { confidence: 'h', frp: 1 } }]
    fetchResponses = [
      new Response('boom', { status: 500 }),
      csvResponse(),
      csvResponse(),
      csvResponse(),
    ]

    const res = await req(app).get('/environment/wildfire/hotspots', {
      query: { bbox: BBOX },
    })

    expect(res.status).toBe(200)
    expect(res.body.features.length).toBeGreaterThan(0)
  })
})

describe('GET /environment/wildfire/perimeters and /smoke', () => {
  function arcgisResponse(features: unknown[]) {
    return new Response(JSON.stringify({ type: 'FeatureCollection', features }), {
      headers: { 'content-type': 'application/json' },
    })
  }

  test('perimeters queries the NIFC feature server with the bbox', async () => {
    fetchResponses = [arcgisResponse([{ id: 'fire-1' }])]

    const res = await req(app).get('/environment/wildfire/perimeters', {
      query: { bbox: BBOX },
    })

    expect(res.status).toBe(200)
    expect(fetchCalls[0]).toContain('WFIGS_Interagency_Perimeters_Current')
    expect(decodeURIComponent(fetchCalls[0])).toContain('-81,35,-80,36')
    expect(res.body.features).toHaveLength(1)
  })

  test('smoke queries the NOAA HMS feature server', async () => {
    fetchResponses = [arcgisResponse([{ id: 'smoke-1' }])]

    const res = await req(app).get('/environment/wildfire/smoke', {
      query: { bbox: BBOX },
    })

    expect(res.status).toBe(200)
    expect(fetchCalls[0]).toContain('NOAA_Satellite_Smoke_Detection')
  })

  test('degrades to an empty collection when ArcGIS errors', async () => {
    fetchResponses = [new Response('nope', { status: 503 })]

    const res = await req(app).get('/environment/wildfire/perimeters', {
      query: { bbox: BBOX },
    })

    expect(res.body).toEqual(EMPTY_FC)
  })

  test('degrades when ArcGIS returns a non-FeatureCollection payload', async () => {
    fetchResponses = [
      new Response(JSON.stringify({ error: 'invalid token' }), {
        headers: { 'content-type': 'application/json' },
      }),
    ]

    const res = await req(app).get('/environment/wildfire/smoke', {
      query: { bbox: BBOX },
    })

    expect(res.body).toEqual(EMPTY_FC)
  })

  test('degrades when the request throws', async () => {
    fetchError = new Error('timeout')

    const res = await req(app).get('/environment/wildfire/perimeters', {
      query: { bbox: BBOX },
    })

    expect(res.body).toEqual(EMPTY_FC)
  })

  test('perimeters are cacheable for 30 minutes', async () => {
    fetchResponses = [arcgisResponse([])]

    const res = await req(app).get('/environment/wildfire/perimeters', {
      query: { bbox: BBOX },
    })

    expect(res.headers.get('cache-control')).toBe('public, max-age=1800')
  })
})
