/**
 * Endpoint tests for the places controller.
 *
 * `/details` accepts three mutually exclusive lookup shapes (id, name+coords,
 * bare coords) and the precedence between them is easy to break, so each is
 * pinned here along with the Geoapify→OSM redirect. The route uses optional
 * auth: anonymous callers get results, and premium data providers are gated on
 * a permission rather than on being signed in.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { authMockModule, setAuthUser, resetAuth, TEST_USER } from '../test/auth-mock'
import { createTestApp, req } from '../test/app'

const place = { id: 'osm/node/1', name: 'Cafe' }

const lookupEnrichedPlaceById = mock(
  async (_source: string, _id: string, _opts: any) => place as unknown,
)
const lookupPlaceByNameAndLocation = mock(
  async (_name: string, _coords: any, _opts: any) => place as unknown,
)
const lookupEnrichedPlaceByCoordinates = mock(
  async (_lat: number, _lng: number, _opts: any) => place as unknown,
)

mock.module('../services/place.service', () => ({
  lookupEnrichedPlaceById,
  lookupPlaceByNameAndLocation,
  lookupEnrichedPlaceByCoordinates,
}))

let permissions: string[] = []
const getPermissions = mock(async (_userId: string) => permissions)
const hasPermission = mock((perms: string[], required: string) =>
  perms.includes(required),
)
mock.module('../services/auth.service', () => ({ getPermissions, hasPermission }))

const fetchWidgetData = mock(async (_type: string, _query: any) => ({ departures: [] }))
mock.module('../services/widget.service', () => ({ fetchWidgetData }))

const fetchNearestStreetImage = mock(async (_lat: number, _lng: number) => ({
  url: 'https://images.test/1.jpg',
}))
mock.module('../services/street-imagery.service', () => ({ fetchNearestStreetImage }))

/** Geoapify place returned by the redirect path; may carry an OSM id. */
let geoapifyPlace: any = { id: 'geoapify-1', externalIds: { osm: 'node/99' } }
let geoapifyRecords: any[] = [{ integrationId: 'geoapify' }]
let geoapifyInstance: any = {
  capabilities: { placeInfo: { getPlaceInfo: async () => geoapifyPlace } },
}

mock.module('../services/integrations/index.js', () => ({
  integrationManager: {
    getConfiguredIntegrationsByCapability: () => geoapifyRecords,
    getCachedIntegrationInstance: () => geoapifyInstance,
  },
}))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

mock.module('../middleware/auth.middleware.js', () => authMockModule())
mock.module('../middleware/auth.middleware', () => authMockModule())

const places = (await import('./place.controller')).default
const app = createTestApp(places)

beforeEach(() => {
  resetAuth()
  permissions = []
  lookupEnrichedPlaceById.mockClear()
  lookupEnrichedPlaceById.mockImplementation(async () => place)
  lookupPlaceByNameAndLocation.mockClear()
  lookupPlaceByNameAndLocation.mockImplementation(async () => place)
  lookupEnrichedPlaceByCoordinates.mockClear()
  lookupEnrichedPlaceByCoordinates.mockImplementation(async () => place)
  getPermissions.mockClear()
  fetchWidgetData.mockClear()
  fetchWidgetData.mockImplementation(async () => ({ departures: [] }))
  fetchNearestStreetImage.mockClear()
  fetchNearestStreetImage.mockImplementation(async () => ({
    url: 'https://images.test/1.jpg',
  }))
  geoapifyPlace = { id: 'geoapify-1', externalIds: { osm: 'node/99' } }
  geoapifyRecords = [{ integrationId: 'geoapify' }]
  geoapifyInstance = {
    capabilities: { placeInfo: { getPlaceInfo: async () => geoapifyPlace } },
  }
})

describe('GET /places/details — lookup shape selection', () => {
  test('id lookup wins when source and id are present', async () => {
    const res = await req(app).get('/places/details', {
      query: { source: 'osm', id: 'node/1', lat: 35.2, lng: -80.8 },
    })

    expect(res.status).toBe(200)
    expect(lookupEnrichedPlaceById).toHaveBeenCalled()
    expect(lookupEnrichedPlaceByCoordinates).not.toHaveBeenCalled()
  })

  test('name + coordinates uses the name lookup', async () => {
    await req(app).get('/places/details', {
      query: { name: 'Cafe', lat: 35.2, lng: -80.8 },
    })

    expect(lookupPlaceByNameAndLocation).toHaveBeenCalled()
    expect(lookupEnrichedPlaceByCoordinates).not.toHaveBeenCalled()
  })

  test('bare coordinates fall through to the coordinate lookup', async () => {
    await req(app).get('/places/details', { query: { lat: 35.2, lng: -80.8 } })

    expect(lookupEnrichedPlaceByCoordinates).toHaveBeenCalled()
  })

  test('coordinate lookups ask for address data only', async () => {
    await req(app).get('/places/details', { query: { lat: 35.2, lng: -80.8 } })

    expect(lookupEnrichedPlaceByCoordinates.mock.calls[0][2]).toMatchObject({
      addressOnly: true,
    })
  })

  test('400s when no usable lookup parameters are given', async () => {
    const res = await req(app).get('/places/details', { query: { name: 'Cafe' } })

    expect(res.status).toBe(400)
    expect(lookupPlaceByNameAndLocation).not.toHaveBeenCalled()
  })

  test('400s when source is given without an id', async () => {
    const res = await req(app).get('/places/details', { query: { source: 'osm' } })

    expect(res.status).toBe(400)
  })

  test('404s when the lookup finds nothing', async () => {
    lookupEnrichedPlaceById.mockResolvedValueOnce(null)

    const res = await req(app).get('/places/details', {
      query: { source: 'osm', id: 'node/1' },
    })

    expect(res.status).toBe(404)
  })

  test('500s when the lookup throws', async () => {
    lookupEnrichedPlaceById.mockRejectedValueOnce(new Error('barrelman down'))

    const res = await req(app).get('/places/details', {
      query: { source: 'osm', id: 'node/1' },
    })

    expect(res.status).toBe(500)
  })

  test('rounds a fractional radius before passing it on', async () => {
    await req(app).get('/places/details', {
      query: { lat: 35.2, lng: -80.8, radius: 250.7 },
    })

    expect(lookupEnrichedPlaceByCoordinates.mock.calls[0][2].radius).toBe(251)
  })

  test('defaults the radius to 500m', async () => {
    await req(app).get('/places/details', { query: { lat: 35.2, lng: -80.8 } })

    expect(lookupEnrichedPlaceByCoordinates.mock.calls[0][2].radius).toBe(500)
  })

  test('422s on a source outside the SOURCE enum', async () => {
    const res = await req(app).get('/places/details', {
      query: { source: 'zillow', id: 'x' },
    })

    expect(res.status).toBe(422)
    expect(lookupEnrichedPlaceById).not.toHaveBeenCalled()
  })
})

describe('GET /places/details — OSM id validation', () => {
  for (const osmType of ['node', 'way', 'relation', 'intersection']) {
    test(`accepts an OSM ${osmType} id`, async () => {
      const res = await req(app).get('/places/details', {
        query: { source: 'osm', id: `${osmType}/1` },
      })

      expect(res.status).toBe(200)
    })
  }

  test('400s on an unknown OSM object type', async () => {
    const res = await req(app).get('/places/details', {
      query: { source: 'osm', id: 'building/1' },
    })

    expect(res.status).toBe(400)
    expect(lookupEnrichedPlaceById).not.toHaveBeenCalled()
  })

  test('400s on an OSM id with no type prefix', async () => {
    const res = await req(app).get('/places/details', {
      query: { source: 'osm', id: '12345' },
    })

    expect(res.status).toBe(400)
  })
})

describe('GET /places/details — premium data gating', () => {
  test('anonymous callers get results without premium data', async () => {
    setAuthUser(null)

    const res = await req(app).get('/places/details', {
      query: { source: 'osm', id: 'node/1' },
    })

    expect(res.status).toBe(200)
    expect(lookupEnrichedPlaceById.mock.calls[0][2]).toMatchObject({
      premiumData: false,
      userId: undefined,
    })
  })

  test('does not query permissions for an anonymous caller', async () => {
    setAuthUser(null)

    await req(app).get('/places/details', { query: { source: 'osm', id: 'node/1' } })

    expect(getPermissions).not.toHaveBeenCalled()
  })

  test('a signed-in caller without the permission gets premiumData false', async () => {
    permissions = ['places:read']

    await req(app).get('/places/details', { query: { source: 'osm', id: 'node/1' } })

    expect(lookupEnrichedPlaceById.mock.calls[0][2]).toMatchObject({
      premiumData: false,
      userId: TEST_USER.id,
    })
  })

  test('a caller holding premium:data-providers gets premiumData true', async () => {
    permissions = ['premium:data-providers']
    hasPermission.mockImplementationOnce(() => true)

    await req(app).get('/places/details', { query: { source: 'osm', id: 'node/1' } })

    expect(lookupEnrichedPlaceById.mock.calls[0][2].premiumData).toBe(true)
  })
})

describe('GET /places/details — Geoapify redirect', () => {
  test('redirects to the OSM lookup when the Geoapify place carries an OSM id', async () => {
    const res = await req(app).get('/places/details', {
      query: { source: 'geoapify', id: 'geoapify-1' },
    })

    expect(res.status).toBe(200)
    expect(lookupEnrichedPlaceById).toHaveBeenCalled()
    expect(lookupEnrichedPlaceById.mock.calls[0][1]).toBe('node/99')
  })

  test('returns the Geoapify payload as-is when it has no OSM id', async () => {
    geoapifyPlace = { id: 'geoapify-1', externalIds: {} }

    const res = await req(app).get('/places/details', {
      query: { source: 'geoapify', id: 'geoapify-1' },
    })

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('geoapify-1')
    expect(lookupEnrichedPlaceById).not.toHaveBeenCalled()
  })

  test('404s when Geoapify has no such place', async () => {
    geoapifyPlace = null

    const res = await req(app).get('/places/details', {
      query: { source: 'geoapify', id: 'missing' },
    })

    expect(res.status).toBe(404)
  })

  test('500s when no Geoapify integration is configured', async () => {
    geoapifyRecords = []

    const res = await req(app).get('/places/details', {
      query: { source: 'geoapify', id: 'geoapify-1' },
    })

    expect(res.status).toBe(500)
  })

  test('500s when the Geoapify instance lacks placeInfo', async () => {
    geoapifyInstance = { capabilities: {} }

    const res = await req(app).get('/places/details', {
      query: { source: 'geoapify', id: 'geoapify-1' },
    })

    expect(res.status).toBe(500)
  })
})

describe('GET /places/widgets/:type', () => {
  test('400s on an unknown widget type', async () => {
    const res = await req(app).get('/places/widgets/horoscope')

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('Unknown widget type')
    expect(fetchWidgetData).not.toHaveBeenCalled()
  })

  test('passes the query string through to the widget fetcher', async () => {
    const { WidgetType } = await import('../types/place.types')
    const type = Object.values(WidgetType)[0] as string

    const res = await req(app).get(`/places/widgets/${type}`, {
      query: { stopId: 'stop-1' },
    })

    expect(res.status).toBe(200)
    expect(fetchWidgetData).toHaveBeenCalledWith(type, { stopId: 'stop-1' })
  })

  test('500s with the underlying message when the widget fetch throws', async () => {
    const { WidgetType } = await import('../types/place.types')
    const type = Object.values(WidgetType)[0] as string
    fetchWidgetData.mockRejectedValueOnce(new Error('motis unreachable'))

    const res = await req(app).get(`/places/widgets/${type}`)

    expect(res.status).toBe(500)
    expect(res.body.message).toBe('motis unreachable')
  })
})

describe('GET /places/street-imagery', () => {
  test('returns the nearest image preview', async () => {
    const res = await req(app).get('/places/street-imagery', {
      query: { lat: '35.2', lng: '-80.8' },
    })

    expect(res.status).toBe(200)
    expect(res.body.preview.url).toBe('https://images.test/1.jpg')
    expect(fetchNearestStreetImage).toHaveBeenCalledWith(35.2, -80.8)
  })

  test('400s on non-numeric coordinates', async () => {
    const res = await req(app).get('/places/street-imagery', {
      query: { lat: 'north', lng: '-80.8' },
    })

    expect(res.status).toBe(400)
    expect(fetchNearestStreetImage).not.toHaveBeenCalled()
  })

  test('422s when a coordinate is missing', async () => {
    const res = await req(app).get('/places/street-imagery', {
      query: { lat: '35.2' },
    })

    expect(res.status).toBe(422)
  })

  test('500s when the imagery provider throws', async () => {
    fetchNearestStreetImage.mockRejectedValueOnce(new Error('mapillary 429'))

    const res = await req(app).get('/places/street-imagery', {
      query: { lat: '35.2', lng: '-80.8' },
    })

    expect(res.status).toBe(500)
    expect(res.body.message).toBe('mapillary 429')
  })

  test('is reachable anonymously', async () => {
    setAuthUser(null)

    const res = await req(app).get('/places/street-imagery', {
      query: { lat: '35.2', lng: '-80.8' },
    })

    expect(res.status).toBe(200)
  })
})
