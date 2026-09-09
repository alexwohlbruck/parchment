/**
 * Endpoint tests for the search controller.
 *
 * Search is anonymous-friendly (optional auth), so the first thing pinned here
 * is that a signed-out caller still gets results. The rest is coercion and
 * route ordering: query params arrive as strings and must reach the service as
 * numbers/booleans, `/categories/palette` must not be swallowed by
 * `/categories/:categoryId`, and the client's abort signal has to reach the
 * service so a superseded keystroke cancels the upstream request.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { authMockModule, setAuthUser, resetAuth, TEST_USER } from '../test/auth-mock'
import { createTestApp, req } from '../test/app'

const searchResults = { results: [{ id: 'osm/node/1' }] }

const search = mock(
  async (_userId: string, _opts: any, _language: string, _signal?: AbortSignal) =>
    searchResults as unknown,
)
const searchAlongRoute = mock(async (_route: any, _opts: any) => [{ id: 'p1' }])
const searchByCategory = mock(async (_presetId: string, _opts: any) => [{ id: 'p1' }])

mock.module('../services/search.service', () => ({
  search,
  searchAlongRoute,
  searchByCategory,
}))

const searchByBrand = mock(async (_key: string, _opts: any) => ({
  brand: { key: 'starbucks', name: 'Starbucks' },
  results: [{ id: 'p1' }],
}))
mock.module('../services/brand.service', () => ({ searchByBrand }))

const executeRawQuery = mock(async (_query: string, _max: number) => [{ id: 'p1' }])
let overpassRecord: unknown = { integrationId: 'overpass' }
let overpassInstance: any = { integrationId: 'overpass', executeRawQuery }

mock.module('../services/integrations', () => ({
  integrationManager: {
    getConfiguredIntegrationForSource: () => overpassRecord,
    getCachedIntegrationInstance: () => overpassInstance,
  },
}))

mock.module('../services/integrations/overpass-integration', () => ({
  OverpassIntegration: class {},
}))

const loadCategories = mock((_language: string) =>
  Array.from({ length: 5 }, (_, i) => ({ id: `preset-${i}`, name: `Preset ${i}` })),
)
const getCategoryById = mock((id: string, _language: string) =>
  id === 'known' ? { id, name: 'Known' } : null,
)
mock.module('../services/category.service', () => ({
  categoryService: { loadCategories, getCategoryById },
}))

mock.module('../lib/place-categories', () => ({
  categoryPalette: { food: { color: '#f00', label: 'Food' } },
}))

mock.module('../lib/osm-presets', () => ({
  getPresetById: (id: string) => (id === 'known-preset' ? { id } : null),
  getPresetFields: () => [{ key: 'cuisine', label: 'Cuisine' }],
}))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

mock.module('../middleware/auth.middleware', () => authMockModule())

const searchController = (await import('./search.controller')).default
const app = createTestApp(searchController)

const bounds = { north: 36, south: 35, east: -80, west: -81 }

beforeEach(() => {
  resetAuth()
  overpassRecord = { integrationId: 'overpass' }
  overpassInstance = { integrationId: 'overpass', executeRawQuery }
  search.mockClear()
  search.mockImplementation(async () => searchResults)
  searchAlongRoute.mockClear()
  searchAlongRoute.mockImplementation(async () => [{ id: 'p1' }])
  searchByCategory.mockClear()
  searchByCategory.mockImplementation(async () => [{ id: 'p1' }])
  searchByBrand.mockClear()
  searchByBrand.mockImplementation(async () => ({
    brand: { key: 'starbucks', name: 'Starbucks' },
    results: [{ id: 'p1' }],
  }))
  executeRawQuery.mockClear()
  executeRawQuery.mockImplementation(async () => [{ id: 'p1' }])
  loadCategories.mockClear()
  getCategoryById.mockClear()
})

describe('GET /search', () => {
  test('returns results for a signed-in caller', async () => {
    const res = await req(app).get('/search', { query: { q: 'coffee' } })

    expect(res.status).toBe(200)
    expect(search.mock.calls[0][0]).toBe(TEST_USER.id)
    expect(search.mock.calls[0][1].query).toBe('coffee')
  })

  test('serves anonymous callers with an empty user id', async () => {
    setAuthUser(null)

    const res = await req(app).get('/search', { query: { q: 'coffee' } })

    expect(res.status).toBe(200)
    expect(search.mock.calls[0][0]).toBe('')
  })

  test('coerces lat/lng/radius/maxResults to numbers', async () => {
    await req(app).get('/search', {
      query: { q: 'coffee', lat: '35.2', lng: '-80.8', radius: '500', maxResults: '10' },
    })

    const opts = search.mock.calls[0][1]
    expect(opts.lat).toBe(35.2)
    expect(opts.lng).toBe(-80.8)
    expect(opts.radius).toBe(500)
    expect(opts.maxResults).toBe(10)
  })

  test('defaults radius to 10km and maxResults to 50', async () => {
    await req(app).get('/search', { query: { q: 'coffee' } })

    expect(search.mock.calls[0][1].radius).toBe(10000)
    expect(search.mock.calls[0][1].maxResults).toBe(50)
  })

  test('leaves coordinates undefined when not supplied', async () => {
    await req(app).get('/search', { query: { q: 'coffee' } })

    expect(search.mock.calls[0][1].lat).toBeUndefined()
    expect(search.mock.calls[0][1].lng).toBeUndefined()
  })

  test('treats the string "true" as autocomplete', async () => {
    await req(app).get('/search', { query: { q: 'cof', autocomplete: 'true' } })

    expect(search.mock.calls[0][1].autocomplete).toBe(true)
  })

  test('treats any other autocomplete string as false', async () => {
    await req(app).get('/search', { query: { q: 'cof', autocomplete: 'false' } })

    expect(search.mock.calls[0][1].autocomplete).toBe(false)
  })

  test('defaults the query to an empty string', async () => {
    await req(app).get('/search')

    expect(search.mock.calls[0][1].query).toBe('')
  })

  test('forwards the request abort signal so a superseded search is cancelled', async () => {
    await req(app).get('/search', { query: { q: 'coffee' } })

    expect(search.mock.calls[0][3]).toBeInstanceOf(AbortSignal)
  })
})

describe('POST /search/advanced', () => {
  const body = { query: '[out:json];node["amenity"="cafe"];out;' }

  test('runs the raw Overpass query', async () => {
    const res = await req(app).post('/search/advanced', { body })

    expect(res.status).toBe(200)
    expect(executeRawQuery).toHaveBeenCalledWith(body.query, 100)
    expect(res.body.totalCount).toBe(1)
    expect(res.body.query).toBe(body.query)
  })

  test('honours an explicit maxResults', async () => {
    await req(app).post('/search/advanced', { body: { ...body, maxResults: 5 } })

    expect(executeRawQuery.mock.calls[0][1]).toBe(5)
  })

  test('503s when no Overpass integration is configured', async () => {
    overpassRecord = null

    const res = await req(app).post('/search/advanced', { body })

    expect(res.status).toBe(503)
    expect(executeRawQuery).not.toHaveBeenCalled()
  })

  test('503s when the resolved instance is not Overpass', async () => {
    overpassInstance = { integrationId: 'nominatim' }

    const res = await req(app).post('/search/advanced', { body })

    expect(res.status).toBe(503)
  })

  test('500s with the upstream message when the query fails', async () => {
    executeRawQuery.mockRejectedValueOnce(new Error('Overpass timeout'))

    const res = await req(app).post('/search/advanced', { body })

    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Overpass timeout')
  })

  test('422s on an empty query', async () => {
    const res = await req(app).post('/search/advanced', { body: { query: '' } })

    expect(res.status).toBe(422)
  })

  test('422s when maxResults exceeds 1000', async () => {
    const res = await req(app).post('/search/advanced', {
      body: { ...body, maxResults: 5000 },
    })

    expect(res.status).toBe(422)
  })
})

describe('POST /search/route', () => {
  const route = {
    type: 'LineString',
    coordinates: [
      [-80.8, 35.2],
      [-80.9, 35.3],
    ],
  }

  test('searches the corridor around a route', async () => {
    const res = await req(app).post('/search/route', {
      body: { route, query: 'gas', buffer: 500 },
    })

    expect(res.status).toBe(200)
    expect(searchAlongRoute.mock.calls[0][0]).toEqual(route)
    expect(searchAlongRoute.mock.calls[0][1]).toMatchObject({
      query: 'gas',
      buffer: 500,
    })
    expect(res.body.totalCount).toBe(1)
  })

  test('does not pass the route through as a search option', async () => {
    await req(app).post('/search/route', { body: { route } })

    expect((searchAlongRoute.mock.calls[0][1] as any).route).toBeUndefined()
  })

  test('422s on a non-LineString geometry', async () => {
    const res = await req(app).post('/search/route', {
      body: { route: { type: 'Point', coordinates: [[-80.8, 35.2]] } },
    })

    expect(res.status).toBe(422)
    expect(searchAlongRoute).not.toHaveBeenCalled()
  })

  test('422s on a coordinate that is not a pair', async () => {
    const res = await req(app).post('/search/route', {
      body: { route: { type: 'LineString', coordinates: [[-80.8, 35.2, 100]] } },
    })

    expect(res.status).toBe(422)
  })

  test('422s when the buffer is out of range', async () => {
    const res = await req(app).post('/search/route', {
      body: { route, buffer: 99 },
    })

    expect(res.status).toBe(422)
  })

  test('500s when the service throws', async () => {
    searchAlongRoute.mockRejectedValueOnce(new Error('corridor query failed'))

    const res = await req(app).post('/search/route', { body: { route } })

    expect(res.status).toBe(500)
    expect(res.body.message).toBe('corridor query failed')
  })
})

describe('POST /search/category', () => {
  test('searches a preset within the viewport', async () => {
    const res = await req(app).post('/search/category', {
      body: { presetId: 'known-preset', bounds },
    })

    expect(res.status).toBe(200)
    expect(searchByCategory).toHaveBeenCalledWith('known-preset', {
      bounds,
      limit: 30,
      offset: 0,
      sort: undefined,
      filter: undefined,
      tags: undefined,
    })
  })

  test('returns the preset field definitions for a known preset', async () => {
    const res = await req(app).post('/search/category', {
      body: { presetId: 'known-preset', bounds },
    })

    expect(res.body.fieldDefinitions).toEqual([{ key: 'cuisine', label: 'Cuisine' }])
  })

  test('returns no field definitions for an unknown preset', async () => {
    const res = await req(app).post('/search/category', {
      body: { presetId: 'mystery', bounds },
    })

    expect(res.body.fieldDefinitions).toEqual([])
  })

  test('reports hasMore when a full page came back', async () => {
    searchByCategory.mockResolvedValueOnce(
      Array.from({ length: 30 }, (_, i) => ({ id: `p${i}` })),
    )

    const res = await req(app).post('/search/category', {
      body: { presetId: 'known-preset', bounds },
    })

    expect(res.body.hasMore).toBe(true)
  })

  test('reports hasMore false on a short page', async () => {
    const res = await req(app).post('/search/category', {
      body: { presetId: 'known-preset', bounds },
    })

    expect(res.body.hasMore).toBe(false)
  })

  test('passes pagination, sort and filters through', async () => {
    await req(app).post('/search/category', {
      body: {
        presetId: 'known-preset',
        bounds,
        maxResults: 10,
        offset: 20,
        sort: 'distance',
        filter: { fee: 'no', hasHours: true },
        tags: { cuisine: 'coffee_shop' },
      },
    })

    expect(searchByCategory.mock.calls[0][1]).toMatchObject({
      limit: 10,
      offset: 20,
      sort: 'distance',
      filter: { fee: 'no', hasHours: true },
      tags: { cuisine: 'coffee_shop' },
    })
  })

  test('422s without bounds', async () => {
    const res = await req(app).post('/search/category', {
      body: { presetId: 'known-preset' },
    })

    expect(res.status).toBe(422)
    expect(searchByCategory).not.toHaveBeenCalled()
  })

  test('422s on an unknown sort', async () => {
    const res = await req(app).post('/search/category', {
      body: { presetId: 'known-preset', bounds, sort: 'popularity' },
    })

    expect(res.status).toBe(422)
  })

  test('500s when the category search throws', async () => {
    searchByCategory.mockRejectedValueOnce(new Error('preset query failed'))

    const res = await req(app).post('/search/category', {
      body: { presetId: 'known-preset', bounds },
    })

    expect(res.status).toBe(500)
  })
})

describe('POST /search/brand', () => {
  test('searches all locations of a brand', async () => {
    const res = await req(app).post('/search/brand', {
      body: { brandKey: 'starbucks', bounds },
    })

    expect(res.status).toBe(200)
    expect(res.body.brandKey).toBe('starbucks')
    expect(res.body.brand.name).toBe('Starbucks')
    expect(res.body.totalCount).toBe(1)
  })

  test('passes the viewport and widening hints through', async () => {
    await req(app).post('/search/brand', {
      body: {
        brandKey: 'starbucks',
        brandName: 'Starbucks',
        bounds,
        lat: 35.2,
        lng: -80.8,
        minResults: 5,
        maxResults: 50,
      },
    })

    expect(searchByBrand.mock.calls[0][1]).toMatchObject({
      brandName: 'Starbucks',
      bounds,
      lat: 35.2,
      lng: -80.8,
      minResults: 5,
      maxResults: 50,
    })
  })

  test('422s on an empty brand key', async () => {
    const res = await req(app).post('/search/brand', { body: { brandKey: '' } })

    expect(res.status).toBe(422)
    expect(searchByBrand).not.toHaveBeenCalled()
  })

  test('500s when the brand search throws', async () => {
    searchByBrand.mockRejectedValueOnce(new Error('brand lookup failed'))

    const res = await req(app).post('/search/brand', { body: { brandKey: 'x' } })

    expect(res.status).toBe(500)
  })
})

describe('category endpoints', () => {
  test('/categories/palette is not captured by /categories/:categoryId', async () => {
    const res = await req(app).get('/search/categories/palette')

    expect(res.status).toBe(200)
    expect(res.body.palette.food.label).toBe('Food')
    expect(getCategoryById).not.toHaveBeenCalled()
  })

  test('/categories lists presets with a total count', async () => {
    const res = await req(app).get('/search/categories')

    expect(res.status).toBe(200)
    expect(res.body.categories).toHaveLength(5)
    expect(res.body.totalCount).toBe(5)
  })

  test('/categories truncates to maxResults but reports the true total', async () => {
    const res = await req(app).get('/search/categories', {
      query: { maxResults: '2' },
    })

    expect(res.body.categories).toHaveLength(2)
    expect(res.body.totalCount).toBe(5)
  })

  test('/categories 500s when loading fails', async () => {
    loadCategories.mockImplementationOnce(() => {
      throw new Error('preset file missing')
    })

    const res = await req(app).get('/search/categories')

    expect(res.status).toBe(500)
  })

  test('/categories/:id returns a known category', async () => {
    const res = await req(app).get('/search/categories/known')

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Known')
  })

  test('/categories/:id 404s for an unknown category', async () => {
    const res = await req(app).get('/search/categories/nope')

    expect(res.status).toBe(404)
  })

  test('category endpoints are reachable anonymously', async () => {
    setAuthUser(null)

    expect((await req(app).get('/search/categories')).status).toBe(200)
    expect((await req(app).get('/search/categories/palette')).status).toBe(200)
  })
})
