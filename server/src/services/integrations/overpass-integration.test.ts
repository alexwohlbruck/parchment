/**
 * Unit tests for the Overpass integration.
 *
 * Everything here is string-built Overpass QL posted as a form field, so the
 * tests read the generated query back out of the request body. The details
 * that matter and are easy to get backwards:
 *
 * - Overpass bounding boxes are (south,west,north,east) — the opposite corner
 *   order from most of the rest of the codebase.
 * - `area()` ids are offsets, not OSM ids: relations are 3600000000 + id and
 *   ways 2400000000 + id. Using the raw id queries a completely unrelated area.
 * - `is_in()` returns innermost-first, and the filter has to reject admin
 *   boundaries or every place ends up "inside" a county.
 *
 * `executeRawQuery` is the one method that THROWS on failure rather than
 * returning an empty list: it backs an explicit user query, where silence would
 * read as "no results" instead of "the server is down".
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import { createAxiosMock } from '../../test/axios-mock'

const http = createAxiosMock()
mock.module('axios', () => http.module)

mock.module('../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const { OverpassIntegration } = await import('./overpass-integration')

const HOST = 'https://overpass.test/api/interpreter'
const validConfig = { host: HOST }

function configured() {
  const integration = new OverpassIntegration()
  integration.initialize(validConfig)
  return integration
}

/** The Overpass QL sent with the request at `index`. */
const queryOf = (index = 0) =>
  (http.post.mock.calls[index][1] as URLSearchParams).get('data') as string

/** A node element with a name and coordinates. */
const node = (over: Record<string, unknown> = {}) => ({
  type: 'node',
  id: 123456,
  lat: 35.2271,
  lon: -80.8431,
  tags: { name: 'Amelie’s French Bakery', amenity: 'cafe' },
  ...over,
})

const elements = (list: unknown[]) => ({ data: { elements: list } })

const bounds = { north: 35.3, south: 35.1, east: -80.7, west: -80.9 }

const realLog = console.log
const realDebug = console.debug

beforeEach(() => {
  http.reset()
  console.log = () => {}
  console.debug = () => {}
})

afterEach(() => {
  console.log = realLog
  console.debug = realDebug
})

describe('configuration', () => {
  test('requires a host', () => {
    const integration = new OverpassIntegration()

    expect(integration.validateConfig(validConfig)).toBe(true)
    expect(integration.validateConfig({ host: '' })).toBe(false)
    expect(integration.validateConfig(undefined as any)).toBe(false)
  })

  test('declares category search and place info over the OSM source', () => {
    const integration = new OverpassIntegration()

    expect(integration.capabilityIds).toEqual(['searchCategory', 'placeInfo'])
    expect(integration.sources).toEqual(['osm'])
  })

  test('every method no-ops when no host is configured', async () => {
    const integration = new OverpassIntegration()

    expect(await integration.searchPlaces('bakery')).toEqual([])
    expect(await integration.searchByCategory('amenity/cafe', bounds)).toEqual([])
    expect(await integration.searchByCategoryInArea('way/1', ['amenity/cafe'])).toEqual([])
    expect(await integration.findContainingAreas(35, -80)).toEqual([])
    expect(http.post).not.toHaveBeenCalled()
  })

  test('executeRawQuery throws instead of no-opping without a host', async () => {
    await expect(
      new OverpassIntegration().executeRawQuery('[out:json];node(1);out;', 10),
    ).rejects.toThrow('host not configured')
  })
})

describe('testConnection', () => {
  test('posts a trivial query as a form field', async () => {
    http.post.mockResolvedValueOnce(elements([]))

    const result = await new OverpassIntegration().testConnection(validConfig)

    expect(result).toEqual({ success: true })
    expect(http.post.mock.calls[0][0]).toBe(HOST)
    expect(queryOf()).toContain('[out:json]')
    expect(http.post.mock.calls[0][2].headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    )
  })

  test('rejects a config with no host without a request', async () => {
    const result = await new OverpassIntegration().testConnection({ host: '' })

    expect(result.success).toBe(false)
    expect(http.post).not.toHaveBeenCalled()
  })

  test('fails when the response has no elements array', async () => {
    http.post.mockResolvedValueOnce({ data: { remark: 'runtime error' } })

    const result = await new OverpassIntegration().testConnection(validConfig)

    expect(result).toEqual({
      success: false,
      message: 'Invalid response format from Overpass API',
    })
  })

  test('surfaces a connection failure message', async () => {
    http.post.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    expect(
      (await new OverpassIntegration().testConnection(validConfig)).message,
    ).toBe('ECONNREFUSED')
  })
})

describe('getPlaceInfo', () => {
  const info = (integration: any) => integration.capabilities.placeInfo.getPlaceInfo

  test('queries by OSM type and id', async () => {
    http.post.mockResolvedValueOnce(elements([node()]))

    const place = await info(configured())('node/123456')

    expect(place.name.value).toBe('Amelie’s French Bakery')
    expect(queryOf()).toContain('node(123456)')
  })

  test('strips the osm/ provider prefix', async () => {
    http.post.mockResolvedValueOnce(elements([node()]))

    await info(configured())('osm/way/999')

    expect(queryOf()).toContain('way(999)')
  })

  test('asks for geometry and metadata so ways can be centered', async () => {
    http.post.mockResolvedValueOnce(elements([node()]))

    await info(configured())('node/123456')

    expect(queryOf()).toContain('out body geom meta')
  })

  test('computes a center for a way from its geometry', async () => {
    http.post.mockResolvedValueOnce(
      elements([
        {
          type: 'way',
          id: 55,
          tags: { name: 'A building' },
          geometry: [
            { lat: 35.0, lon: -80.0 },
            { lat: 35.2, lon: -80.2 },
          ],
        },
      ]),
    )

    const place = await info(configured())('way/55')

    expect(place.geometry.value.center.lat).toBeCloseTo(35.1, 5)
    expect(place.geometry.value.center.lng).toBeCloseTo(-80.1, 5)
  })

  test('returns null when nothing matches the id', async () => {
    http.post.mockResolvedValueOnce(elements([]))

    expect(await info(configured())('node/999')).toBeNull()
  })

  test('returns null rather than throwing on a request failure', async () => {
    http.post.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    expect(await info(configured())('node/123456')).toBeNull()
  })
})

describe('searchPlaces', () => {
  test('searches name, brand and operator tags', async () => {
    http.post.mockResolvedValueOnce(elements([node()]))

    const results = await configured().searchPlaces('Amelie')

    expect(results).toHaveLength(1)
    const query = queryOf()
    expect(query).toContain('["name"~"Amelie", i]')
    expect(query).toContain('["brand:name"~"Amelie", i]')
    expect(query).toContain('["operator"~"Amelie", i]')
  })

  test('strips quotes that would break out of the query string', async () => {
    http.post.mockResolvedValueOnce(elements([]))

    await configured().searchPlaces('Amelie\'s "Bakery"')

    expect(queryOf()).toContain('["name"~"Amelies Bakery", i]')
  })

  test('searches globally without coordinates', async () => {
    http.post.mockResolvedValueOnce(elements([]))

    await configured().searchPlaces('bakery')

    expect(queryOf()).toContain('(global)')
  })

  test('searches around a point with a default 1 km radius', async () => {
    http.post.mockResolvedValueOnce(elements([]))

    await configured().searchPlaces('bakery', 35.2271, -80.8431)

    expect(queryOf()).toContain('(around:1000,35.2271,-80.8431)')
  })

  test('honours an explicit radius', async () => {
    http.post.mockResolvedValueOnce(elements([]))

    await configured().searchPlaces('bakery', 35.2271, -80.8431, 250)

    expect(queryOf()).toContain('around:250,')
  })

  test('returns raw elements with a computed center', async () => {
    // This method deliberately returns OSM elements, not adapted Places.
    http.post.mockResolvedValueOnce(elements([node()]))

    const [element] = await configured().searchPlaces('bakery')

    expect(element.type).toBe('node')
    expect(element.center).toEqual({ lat: 35.2271, lon: -80.8431 })
  })

  test('leaves an element’s existing center alone', async () => {
    http.post.mockResolvedValueOnce(
      elements([node({ center: { lat: 1, lon: 2 } })]),
    )

    const [element] = await configured().searchPlaces('bakery')

    expect(element.center).toEqual({ lat: 1, lon: 2 })
  })

  test('returns an empty list when there are no elements', async () => {
    http.post.mockResolvedValueOnce({ data: {} })

    expect(await configured().searchPlaces('bakery')).toEqual([])
  })

  test('returns an empty list on a request failure', async () => {
    http.post.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    expect(await configured().searchPlaces('bakery')).toEqual([])
  })
})

describe('executeRawQuery', () => {
  test('posts the query verbatim and adapts the results', async () => {
    http.post.mockResolvedValueOnce(elements([node()]))

    const places = await configured().executeRawQuery(
      '[out:json];node(123456);out;',
      10,
    )

    expect(places).toHaveLength(1)
    expect(queryOf()).toBe('[out:json];node(123456);out;')
  })

  test('truncates the result set to maxResults', async () => {
    http.post.mockResolvedValueOnce(
      elements([node({ id: 1 }), node({ id: 2 }), node({ id: 3 })]),
    )

    expect(await configured().executeRawQuery('[out:json];out;', 2)).toHaveLength(2)
  })

  test('bounds the request with a timeout', async () => {
    http.post.mockResolvedValueOnce(elements([]))

    await configured().executeRawQuery('[out:json];out;', 10)

    expect(http.post.mock.calls[0][2].timeout).toBe(30000)
  })

  test('returns an empty list when the response has no elements', async () => {
    http.post.mockResolvedValueOnce({ data: {} })

    expect(await configured().executeRawQuery('[out:json];out;', 10)).toEqual([])
  })

  test('throws on a request failure instead of returning nothing', async () => {
    // Silence would read as "your query matched nothing".
    http.post.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    await expect(
      configured().executeRawQuery('[out:json];out;', 10),
    ).rejects.toThrow('Failed to execute Overpass query: ECONNREFUSED')
  })
})

describe('searchByCategory', () => {
  test('translates a preset into an OSM tag filter', async () => {
    http.post.mockResolvedValueOnce(elements([node()]))

    const places = await configured().searchByCategory('amenity/cafe', bounds)

    expect(places).toHaveLength(1)
    expect(queryOf()).toContain('["amenity"="cafe"]')
  })

  test('queries nodes, ways and relations', async () => {
    http.post.mockResolvedValueOnce(elements([]))

    await configured().searchByCategory('amenity/cafe', bounds)

    const query = queryOf()
    expect(query).toContain('node["amenity"="cafe"]')
    expect(query).toContain('way["amenity"="cafe"]')
    expect(query).toContain('relation["amenity"="cafe"]')
  })

  test('writes the bbox as south,west,north,east', async () => {
    // Overpass corner order differs from the MapBounds field order.
    http.post.mockResolvedValueOnce(elements([]))

    await configured().searchByCategory('amenity/cafe', bounds)

    expect(queryOf()).toContain('(35.1,-80.9,35.3,-80.7)')
  })

  test('skips the request for a preset with no value', async () => {
    expect(await configured().searchByCategory('amenity', bounds)).toEqual([])
    expect(http.post).not.toHaveBeenCalled()
  })

  test('truncates to the requested limit', async () => {
    http.post.mockResolvedValueOnce(
      elements([node({ id: 1 }), node({ id: 2 }), node({ id: 3 })]),
    )

    expect(
      await configured().searchByCategory('amenity/cafe', bounds, { limit: 2 }),
    ).toHaveLength(2)
  })

  test('skips elements the adapter cannot convert', async () => {
    // One malformed element must not lose the whole result set.
    http.post.mockResolvedValueOnce(elements([node(), null]))

    expect(await configured().searchByCategory('amenity/cafe', bounds)).toHaveLength(1)
  })

  test('returns an empty list on a request failure', async () => {
    http.post.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    expect(await configured().searchByCategory('amenity/cafe', bounds)).toEqual([])
  })
})

describe('searchByCategoryInArea', () => {
  const bbox = { south: 35.1, west: -80.9, north: 35.3, east: -80.7 }

  test('prefers a bbox query when a bounding box is available', async () => {
    // Faster than area() and needs no Overpass area pre-computation.
    http.post.mockResolvedValueOnce(elements([node()]))

    const places = await configured().searchByCategoryInArea(
      'way/123',
      ['amenity/parking'],
      { bbox },
    )

    expect(places).toHaveLength(1)
    expect(queryOf()).toContain('node["amenity"="parking"](35.1,-80.9,35.3,-80.7)')
    expect(queryOf()).not.toContain('area(')
  })

  test('unions every requested preset', async () => {
    http.post.mockResolvedValueOnce(elements([]))

    await configured().searchByCategoryInArea(
      'way/123',
      ['amenity/parking', 'amenity/cafe'],
      { bbox },
    )

    const query = queryOf()
    expect(query).toContain('["amenity"="parking"]')
    expect(query).toContain('["amenity"="cafe"]')
  })

  test('offsets a relation id into the Overpass area space', async () => {
    http.post.mockResolvedValueOnce(elements([]))

    await configured().searchByCategoryInArea('relation/1234', ['amenity/cafe'])

    expect(queryOf()).toContain('area(id:3600001234)')
  })

  test('uses the way offset for a way id', async () => {
    http.post.mockResolvedValueOnce(elements([]))

    await configured().searchByCategoryInArea('way/1234', ['amenity/cafe'])

    expect(queryOf()).toContain('area(id:2400001234)')
  })

  test('refuses to build an area from a node', async () => {
    // Only ways and relations have an Overpass area equivalent.
    expect(
      await configured().searchByCategoryInArea('node/1234', ['amenity/cafe']),
    ).toEqual([])
    expect(http.post).not.toHaveBeenCalled()
  })

  test('skips the request when no preset maps to tags', async () => {
    expect(
      await configured().searchByCategoryInArea('way/1', ['nonsense'], { bbox }),
    ).toEqual([])
    expect(http.post).not.toHaveBeenCalled()
  })

  test('defaults the limit to 30', async () => {
    http.post.mockResolvedValueOnce(elements([]))

    await configured().searchByCategoryInArea('way/1', ['amenity/cafe'], { bbox })

    expect(queryOf()).toContain('out body geom 30;')
  })

  test('honours an explicit limit', async () => {
    http.post.mockResolvedValueOnce(elements([]))

    await configured().searchByCategoryInArea('way/1', ['amenity/cafe'], {
      bbox,
      limit: 5,
    })

    expect(queryOf()).toContain('out body geom 5;')
  })

  test('returns an empty list on a bbox query failure', async () => {
    http.post.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    expect(
      await configured().searchByCategoryInArea('way/1', ['amenity/cafe'], { bbox }),
    ).toEqual([])
  })

  test('returns an empty list on an area query failure', async () => {
    http.post.mockRejectedValueOnce(new Error('timeout'))

    expect(
      await configured().searchByCategoryInArea('relation/1', ['amenity/cafe']),
    ).toEqual([])
  })
})

describe('findContainingAreas', () => {
  const area = (tags: Record<string, string>, over: Record<string, unknown> = {}) => ({
    type: 'way',
    id: 1,
    tags,
    ...over,
  })

  test('queries is_in at the point', async () => {
    http.post.mockResolvedValueOnce(elements([]))

    await configured().findContainingAreas(35.2271, -80.8431)

    expect(queryOf()).toContain('is_in(35.2271,-80.8431)')
  })

  test('returns named containers with a derived type', async () => {
    http.post.mockResolvedValueOnce(
      elements([area({ name: 'Freedom Park', leisure: 'park' })]),
    )

    const areas = await configured().findContainingAreas(35, -80)

    expect(areas).toEqual([
      {
        id: 'way/1',
        name: 'Freedom Park',
        placeType: 'Park',
        tags: { name: 'Freedom Park', leisure: 'park' },
      },
    ])
  })

  test('preserves the innermost-first order Overpass returns', async () => {
    http.post.mockResolvedValueOnce(
      elements([
        area({ name: 'Small Park', leisure: 'park' }, { id: 1 }),
        area({ name: 'Big Campus', amenity: 'university' }, { id: 2 }),
      ]),
    )

    const areas = await configured().findContainingAreas(35, -80)

    expect(areas.map((a) => a.name)).toEqual(['Small Park', 'Big Campus'])
  })

  test('drops unnamed areas', async () => {
    http.post.mockResolvedValueOnce(elements([area({ leisure: 'park' })]))

    expect(await configured().findContainingAreas(35, -80)).toEqual([])
  })

  test('drops administrative boundaries', async () => {
    // Otherwise every place is "inside" its county and state.
    http.post.mockResolvedValueOnce(
      elements([
        area({ name: 'Mecklenburg County', boundary: 'administrative' }),
        area({ name: 'North Carolina', admin_level: '4' }),
      ]),
    )

    expect(await configured().findContainingAreas(35, -80)).toEqual([])
  })

  test('keeps interesting landuse but drops the rest', async () => {
    http.post.mockResolvedValueOnce(
      elements([
        area({ name: 'Uptown', landuse: 'commercial' }, { id: 1 }),
        area({ name: 'Some Field', landuse: 'farmland' }, { id: 2 }),
      ]),
    )

    const areas = await configured().findContainingAreas(35, -80)

    expect(areas.map((a) => a.name)).toEqual(['Uptown'])
  })

  test('returns an empty list on a request failure', async () => {
    http.post.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    expect(await configured().findContainingAreas(35, -80)).toEqual([])
  })
})

describe('container type derivation', () => {
  const typeOf = async (tags: Record<string, string>) => {
    http.reset()
    http.post.mockResolvedValueOnce(
      elements([{ type: 'way', id: 1, tags: { name: 'X', ...tags } }]),
    )
    return (await configured().findContainingAreas(35, -80))[0]?.placeType
  }

  test('names the common container kinds', async () => {
    expect(await typeOf({ aeroway: 'aerodrome' })).toBe('Airport')
    expect(await typeOf({ leisure: 'park' })).toBe('Park')
    expect(await typeOf({ leisure: 'stadium' })).toBe('Stadium')
    expect(await typeOf({ amenity: 'university' })).toBe('University')
    expect(await typeOf({ shop: 'mall' })).toBe('Shopping Mall')
    expect(await typeOf({ tourism: 'theme_park' })).toBe('Theme Park')
  })

  test('prefers the more specific tag when several apply', async () => {
    // A stadium tagged as a building is a Stadium, not a Building.
    expect(await typeOf({ leisure: 'stadium', building: 'yes' })).toBe('Stadium')
  })

  test('title-cases an unlisted building value', async () => {
    expect(await typeOf({ building: 'train_station' })).toBe('Train station')
  })

  test('never surfaces a raw "yes" value', async () => {
    expect(await typeOf({ building: 'yes' })).toBe('Building')
    expect(await typeOf({ amenity: 'yes', building: 'yes' })).toBe('Building')
  })

  test('title-cases an unlisted amenity', async () => {
    expect(await typeOf({ amenity: 'community_centre' })).toBe('Community centre')
  })

  test('labels an interesting landuse area', async () => {
    expect(await typeOf({ landuse: 'education' })).toBe('Educational Campus')
  })
})
