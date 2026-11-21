import { describe, test, expect, mock, beforeEach } from 'bun:test'
import type { Place } from '../../types/place.types'

const mockLookupPlaces = mock(async () => [] as Place[])
const mockLookupPlace = mock(async () => null as Place | null)
const mockSearchByCategory = mock(async () => [] as Place[])
const reachGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-74.01, 40.69],
      [-73.99, 40.69],
      [-73.99, 40.71],
      [-74.01, 40.71],
      [-74.01, 40.69],
    ],
  ],
}
const mockBarrelman = mock(async () =>
  Response.json({
    mode: 'walk',
    isochrones: {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: reachGeometry }],
    },
  }),
)

mock.module('../place.service', () => ({
  lookupPlacesByNameAndLocation: mockLookupPlaces,
  lookupEnrichedPlaceById: mockLookupPlace,
}))
mock.module('../search.service', () => ({
  searchByCategory: mockSearchByCategory,
  searchAlongRoute: mock(async () => []),
}))
const mockGetRoute = mock(async (_locations: unknown, _costing: string) => ({
  routes: [
    {
      geometry: [
        { lat: 40.7, lng: -74 },
        { lat: 40.75, lng: -73.98 },
        { lat: 40.78, lng: -73.97 },
      ],
    },
  ],
}))
mock.module('../routing.service', () => ({
  routingService: { getRoute: mockGetRoute },
}))
const mockAlongRoute = mock(async (_request: any) => [] as any[])
mock.module('../route-search.service', () => ({
  searchAlongNavRoute: mockAlongRoute,
}))
mock.module('../category.service', () => ({
  categoryService: { searchCategories: () => [] },
}))
const corner = {
  id: 'osm/way/7',
  name: { value: 'Washington Square Park' },
  placeType: { value: 'Park' },
  geometry: { value: { center: { lat: 40.7308, lng: -73.9973 } } },
} as any
const mockReverse = mock(async (_lat: number, _lng: number) => ({ results: [corner] }))
mock.module('../geocoding.service', () => ({
  forwardGeocode: mock(async () => ({ results: [] })),
  reverseGeocode: mockReverse,
}))
mock.module('../barrelman.service', () => ({ requestBarrelman: mockBarrelman }))
let permissions: string[] = []
mock.module('../auth.service', () => ({
  getPermissions: async () => permissions,
  hasPermission: (held: string[], rule: string) => held.includes(rule),
}))
const mockCreateCanvas = mock(async (_params: unknown) => ({ id: 'canvas-1' }))
const mockUpdateCanvas = mock(async (_id: string, _userId: string, _updates: any) => ({}))
class PublicLinkNotAllowedOnE2eeError extends Error {}
const mockArchiveCanvas = mock(async (id: string, _userId: string, _archived: boolean) => (id === 'canvas-1' ? {} : undefined))
mock.module('../library/canvases.service', () => ({
  createCanvas: mockCreateCanvas,
  updateCanvas: mockUpdateCanvas,
  getCanvases: mock(async () => [
    { id: 'canvas-1', scheme: 'server-key', name: 'Pizza', body: { layers: [{}, {}] }, publicToken: null, updatedAt: new Date('2026-11-19') },
    { id: 'private', scheme: 'user-e2ee', name: null, body: null, updatedAt: new Date('2026-11-18') },
    { id: 'old', scheme: 'server-key', name: 'Old', archivedAt: new Date(), updatedAt: new Date('2026-01-01') },
  ]),
  createPublicLink: mock(async (id: string) => {
    if (id === 'private') throw new PublicLinkNotAllowedOnE2eeError()
    return id === 'canvas-1' ? { publicToken: 'tok', publicRole: 'viewer' } : null
  }),
  setCanvasArchived: mockArchiveCanvas,
  PublicLinkNotAllowedOnE2eeError,
}))

const loop = { geometry: [[-73.99, 40.73], [-73.93, 40.8]] }
const mockGetRouteById = mock(async (id: string, _userId: string) => (id === 'route-1' ? { id, body: loop } : undefined))
mock.module('../library/routes.service', () => ({
  getRouteById: mockGetRouteById,
  getRoutes: mock(async () => []),
  createRoute: mock(async () => ({ id: 'route-1' })),
  updateRoute: mock(async () => ({})),
  setRouteArchived: mock(async () => ({})),
}))

const { askTools } = await import('./ask-tools')
import type { AskContext } from './ask-tools'
import type { ChatRequest } from '../../types/language-model.types'

const tool = (name: string) => askTools.find((t) => t.name === name)!

function context(userId = 'u1'): AskContext {
  return {
    userId,
    language: 'en-US',
    origin: { lat: 40.7, lng: -74 },
    places: new Map(),
    units: 'metric',
    vehicles: [],
    now: new Date('2026-11-14T15:00:00Z'),
    seen: new Map(),
    routes: new Map(),
    sources: new Map(),
    emit: () => {},
  }
}

beforeEach(() => {
  for (const fn of [
    mockLookupPlaces,
    mockLookupPlace,
    mockSearchByCategory,
    mockBarrelman,
  ])
    fn.mockClear()
})

describe('tool caching', () => {
  test('a repeated name search reuses the first lookup for the same user only', async () => {
    await tool('find_places').run({ query: 'ramen' }, context('u1'))
    await tool('find_places').run({ query: 'ramen ' }, context('u1'))
    expect(mockLookupPlaces).toHaveBeenCalledTimes(1)

    await tool('find_places').run({ query: 'ramen' }, context('u2'))
    expect(mockLookupPlaces).toHaveBeenCalledTimes(2)
  })

  test('place details are cached per user', async () => {
    await tool('get_place')
      .run({ id: 'osm/node/1' }, context('u1'))
      .catch(() => {})
    await tool('get_place')
      .run({ id: 'osm/node/1' }, context('u1'))
      .catch(() => {})
    await tool('get_place')
      .run({ id: 'osm/node/1' }, context('u2'))
      .catch(() => {})
    expect(mockLookupPlace).toHaveBeenCalledTimes(2)
  })

  test('category lists and reach are shared across users', async () => {
    const args = { mode: 'walk', minutes: 10, category_id: 'amenity/cafe' }
    await tool('places_within_reach').run(args, context('u1'))
    await tool('places_within_reach').run(args, context('u2'))
    expect(mockBarrelman).toHaveBeenCalledTimes(1)
    expect(mockSearchByCategory).toHaveBeenCalledTimes(1)
  })

  test('a failed lookup is retried rather than cached', async () => {
    mockLookupPlaces.mockRejectedValueOnce(new Error('down'))
    await expect(
      tool('find_places').run({ query: 'flaky' }, context()),
    ).rejects.toThrow('down')
    await tool('find_places').run({ query: 'flaky' }, context())
    expect(mockLookupPlaces).toHaveBeenCalledTimes(2)
  })
})

describe('places_within_reach', () => {
  test('keeps only places inside the reachable area and draws it', async () => {
    const at = (id: string, lat: number, lng: number) =>
      ({
        id,
        name: { value: id },
        geometry: { value: { center: { lat, lng } } },
      }) as unknown as Place
    mockSearchByCategory.mockResolvedValueOnce([
      at('inside', 40.7, -74),
      at('outside', 40.8, -74),
    ])
    const events: unknown[] = []

    const result = (await tool('places_within_reach').run(
      { mode: 'bike', minutes: 7, category_id: 'amenity/bar' },
      { ...context(), emit: (event) => events.push(event) },
    )) as { places: { id: string }[] }

    expect(result.places.map((p) => p.id)).toEqual(['inside'])
    expect(events).toEqual([{ type: 'reach', geometry: reachGeometry }])
  })
})

describe('search_along_route', () => {
  test('searches the routed line through the stops, reporting distance along and detour', async () => {
    const water = {
      id: 'osm/node/9',
      name: { value: 'Fountain' },
      geometry: {
        value: { type: 'point', center: { lat: 40.75, lng: -73.98 } },
      },
    } as unknown as Place
    mockAlongRoute.mockResolvedValueOnce([
      { place: water, alongDistance: 4200, detourSeconds: 90 },
    ])
    const ctx = { ...context(), units: 'imperial' as const }
    const result = (await tool('search_along_route').run(
      {
        from: { lat: 40.7, lng: -74 },
        to: { lat: 40.78, lng: -73.97 },
        stops: ['40.75, -73.98'],
        mode: 'cycling',
        category_ids: ['amenity/drinking_water'],
      },
      ctx,
    )) as any

    expect((mockGetRoute.mock.calls[0][0] as any[]).length).toBe(3)
    expect(mockGetRoute.mock.calls[0][1]).toBe('bicycle')
    expect(mockAlongRoute.mock.calls[0][0]).toMatchObject({
      mode: 'cycling',
      categories: ['amenity/drinking_water'],
    })
    expect(result.places[0]).toMatchObject({
      name: 'Fountain',
      along_route: '2.6 mi',
      detour_minutes: 2,
    })
    expect(ctx.seen.has('osm/node/9')).toBe(true)
  })
})

describe('web_search', () => {
  test('keeps the pages it read as sources for the answer', async () => {
    const ctx = context()
    const complete = mock(async (_request: ChatRequest) => ({
      message: { role: 'assistant' as const, content: 'The market runs Mon, Wed, Fri and Sat, 8am to 6pm.' },
      citations: [{ url: 'https://www.grownyc.org/greenmarket/manhattan-union-square', title: 'Union Square Greenmarket' }],
    }))
    ctx.model = { complete }
    const result = await tool('web_search').run({ query: 'Union Square Greenmarket days' }, ctx)
    expect(complete.mock.calls[0][0]).toMatchObject({ webSearch: { maxResults: 3 } })
    expect(result).toEqual({
      summary: 'The market runs Mon, Wed, Fri and Sat, 8am to 6pm.',
      count: 1,
      pages: [{ title: 'Union Square Greenmarket', site: 'grownyc.org' }],
    })
    expect([...ctx.sources.keys()]).toEqual(['https://www.grownyc.org/greenmarket/manhattan-union-square'])
  })

  test('says so where there is no model to search with', async () => {
    await expect(tool('web_search').run({ query: 'x' }, context())).rejects.toThrow('not available')
  })
})

describe('create_canvas', () => {
  const pizza = {
    id: 'osm/node/1',
    name: { value: 'Joe’s Pizza' },
    placeType: { value: 'Pizza' },
    geometry: { value: { center: { lat: 40.7306, lng: -73.9894 } } },
  } as any

  test('saves the places a tool found as a canvas and tells the app', async () => {
    permissions = ['library:write']
    const events: unknown[] = []
    const ctx = { ...context(), emit: (event: unknown) => events.push(event) } as AskContext
    ctx.seen.set(pizza.id, pizza)
    const result = await tool('create_canvas').run({ name: 'Pizza', layers: [{ name: 'Pizza', points: [pizza.id] }] }, ctx)
    expect(result).toEqual({ saved: true, id: 'canvas-1', name: 'Pizza', layers: 1 })
    expect(mockUpdateCanvas.mock.calls.at(-1)![2].body.layers[0].data.features[0].properties.name).toBe('Joe’s Pizza')
    expect(events).toEqual([{ type: 'canvas', id: 'canvas-1', name: 'Pizza' }])
  })

  test('marks known places like home, and draws saved routes as route layers', async () => {
    permissions = ['library:write']
    const ctx = context()
    ctx.places.set('home', { name: 'Home', lat: 40.68, lng: -73.96 })
    await tool('create_canvas').run(
      { name: 'Loop', route_ids: ['route-1'], layers: [{ name: 'Stops', points: ['home'] }] },
      ctx,
    )
    const body = mockUpdateCanvas.mock.calls.at(-1)![2].body
    expect(body.layers[0]).toMatchObject({ kind: 'route', routeId: 'route-1' })
    expect(body.layers[1].data.features[0].properties.name).toBe('Home')
  })

  test('refuses routes and places it cannot find, and users without a library', async () => {
    permissions = ['library:write']
    await expect(tool('create_canvas').run({ name: 'x', route_ids: ['route-9'] }, context())).rejects.toThrow(
      'Unknown route route-9',
    )
    await expect(
      tool('create_canvas').run({ name: 'x', layers: [{ name: 'x', points: ['osm/node/9'] }] }, context()),
    ).rejects.toThrow('Couldn\'t find')
    permissions = []
    await expect(tool('create_canvas').run({ name: 'x' }, context())).rejects.toThrow('Basic or Premium')
  })
})

describe('create_canvas areas', () => {
  test('shades how far a travel time reaches', async () => {
    permissions = ['library:write']
    const result = await tool('create_canvas').run(
      { name: 'Coffee runs', areas: [{ mode: 'bike', minutes: 15 }] },
      context(),
    )
    expect(result).toMatchObject({ saved: true, layers: 1 })
    const [area] = mockUpdateCanvas.mock.calls.at(-1)![2].body.layers
    expect(area).toMatchObject({ kind: 'data', render: 'shapes', name: '15 min ride' })
    expect(area.data.features[0].geometry).toEqual(reachGeometry)
  })
})

describe('what_is_here', () => {
  test('names the places at a point so the answer can cite them', async () => {
    const ctx = context()
    const [place] = (await tool('what_is_here').run({ at: { lat: 40.7308, lng: -73.9973 } }, ctx)) as any[]
    expect(place).toMatchObject({ id: 'osm/way/7', name: 'Washington Square Park', type: 'Park' })
    expect(ctx.seen.has('osm/way/7')).toBe(true)
  })
})

describe('library canvases', () => {
  test('lists live canvases the server can read', async () => {
    expect(await tool('my_canvases').run({}, context())).toEqual([
      { id: 'canvas-1', name: 'Pizza', layers: 2, shared: false, updated: '2026-11-19' },
    ])
  })

  test('shares a canvas by link, but never a private one', async () => {
    permissions = ['library:write']
    const { url } = (await tool('share_canvas').run({ id: 'canvas-1' }, context())) as { url: string }
    expect(url.endsWith('/c/tok')).toBe(true)
    await expect(tool('share_canvas').run({ id: 'private' }, context())).rejects.toThrow("Private canvases can't")
    await expect(tool('share_canvas').run({ id: 'nope' }, context())).rejects.toThrow('Unknown canvas')
  })

  test('archives and restores, telling the app', async () => {
    permissions = ['library:write']
    const events: unknown[] = []
    const ctx = { ...context(), emit: (event: unknown) => events.push(event) } as AskContext
    await tool('archive').run({ kind: 'canvas', id: 'canvas-1' }, ctx)
    await tool('archive').run({ kind: 'canvas', id: 'canvas-1', restore: true }, ctx)
    expect(mockArchiveCanvas.mock.calls.map((call) => call[2])).toEqual([true, false])
    expect(events).toEqual([
      { type: 'archived', kind: 'canvas', id: 'canvas-1', archived: true },
      { type: 'archived', kind: 'canvas', id: 'canvas-1', archived: false },
    ])
    await expect(tool('archive').run({ kind: 'canvas', id: 'gone' }, ctx)).rejects.toThrow('Unknown canvas')
  })
})
