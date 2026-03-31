import { describe, test, expect, beforeEach, mock } from 'bun:test'

// ── Axios mock (must be declared before the integration import) ───────────────
const mockAxiosGet = mock((_url: string, _config?: any) => Promise.resolve({ data: null }))
const mockAxiosPost = mock((_url: string, _body?: any, _config?: any) => Promise.resolve({ data: [] }))

mock.module('axios', () => ({
  default: {
    get: mockAxiosGet,
    post: mockAxiosPost,
  },
}))

import { BarrelmanIntegration } from './barrelman-integration'

// ── Test fixtures ─────────────────────────────────────────────────────────────

/** Minimal valid Barrelman API result for a node */
const baseResult = {
  id: 'node/123456',
  osm_type: 'node',
  osm_id: 123456,
  name: 'Test Place',
  tags: {},
  geom_type: 'point',
  geometry: { type: 'Point', coordinates: [-122.4194, 37.7749] },
}

describe('BarrelmanIntegration', () => {
  let integration: BarrelmanIntegration

  beforeEach(() => {
    integration = new BarrelmanIntegration()
    integration.initialize({ host: 'http://localhost:3100' })
    mockAxiosGet.mockClear()
    mockAxiosPost.mockClear()
  })

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  describe('validateConfig', () => {
    test('returns true when host is provided', () => {
      expect(integration.validateConfig({ host: 'http://api.example.com' })).toBe(true)
    })

    test('returns false when host is empty string', () => {
      expect(integration.validateConfig({ host: '' })).toBe(false)
    })

    test('returns false when host is missing', () => {
      expect(integration.validateConfig({} as any)).toBe(false)
    })
  })

  describe('testConnection', () => {
    test('succeeds when health endpoint returns { status: "ok" }', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: { status: 'ok' } })
      const result = await integration.testConnection({ host: 'http://api.example.com' })
      expect(result.success).toBe(true)
    })

    test('fails when health endpoint returns non-ok status', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: { status: 'degraded' } })
      const result = await integration.testConnection({ host: 'http://api.example.com' })
      expect(result.success).toBe(false)
      expect(result.message).toBeDefined()
    })

    test('fails immediately when config has no host', async () => {
      const result = await integration.testConnection({ host: '' })
      expect(result.success).toBe(false)
      expect(result.message).toContain('Host is required')
      // Should not even make a network request
      expect(mockAxiosGet).not.toHaveBeenCalled()
    })

    test('fails gracefully on network error', async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error('ECONNREFUSED'))
      const result = await integration.testConnection({ host: 'http://api.example.com' })
      expect(result.success).toBe(false)
      expect(result.message).toContain('Connection failed')
    })
  })

  // ── Place adaptation ───────────────────────────────────────────────────────

  describe('adaptPlace — IDs and metadata', () => {
    test('prefixes id with "osm/" namespace', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [baseResult] })
      const [place] = await integration.searchPlaces('test')
      expect(place.id).toBe('osm/node/123456')
    })

    test('stores raw OSM id in externalIds["osm"]', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [baseResult] })
      const [place] = await integration.searchPlaces('test')
      expect(place.externalIds['osm']).toBe('node/123456')
    })

    test('maps name to attributed value', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [{ ...baseResult, name: 'Central Library' }] })
      const [place] = await integration.searchPlaces('library')
      expect(place.name?.value).toBe('Central Library')
    })

    test('sets name value to null when name is absent', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [{ ...baseResult, name: null }] })
      const [place] = await integration.searchPlaces('test')
      expect(place.name?.value).toBeNull()
    })

    test('builds OSM source URL for nodes', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [baseResult] })
      const [place] = await integration.searchPlaces('test')
      expect(place.sources[0].url).toBe('https://www.openstreetmap.org/node/123456')
    })

    test('builds OSM source URL for ways', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [{ ...baseResult, id: 'way/789', osm_id: 789 }] })
      const [place] = await integration.searchPlaces('test')
      expect(place.sources[0].url).toBe('https://www.openstreetmap.org/way/789')
    })

    test('includes raw OSM tags on the place', async () => {
      const tags = { amenity: 'cafe', cuisine: 'coffee_shop' }
      mockAxiosPost.mockResolvedValueOnce({ data: [{ ...baseResult, tags }] })
      const [place] = await integration.searchPlaces('test')
      expect(place.tags).toMatchObject(tags)
    })

    test('returns empty array when API returns no results', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [] })
      expect(await integration.searchPlaces('nothing')).toEqual([])
    })
  })

  describe('adaptPlace — geometry', () => {
    test('maps centroid coordinates to point geometry', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [baseResult] })
      const [place] = await integration.searchPlaces('test')
      const geom = place.geometry?.value
      expect(geom?.type).toBe('point')
      expect(geom?.center.lng).toBeCloseTo(-122.4194)
      expect(geom?.center.lat).toBeCloseTo(37.7749)
    })

    test('maps Polygon full_geometry to area type with nodes and bounds', async () => {
      const polyResult = {
        ...baseResult,
        id: 'way/789', osm_id: 789,
        geom_type: 'area',
        full_geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-122.42, 37.77], [-122.41, 37.77],
              [-122.41, 37.78], [-122.42, 37.78],
              [-122.42, 37.77],
            ],
          ],
        },
      }
      mockAxiosPost.mockResolvedValueOnce({ data: [polyResult] })
      const [place] = await integration.searchPlaces('test')
      const geom = place.geometry?.value
      expect(geom?.type).toBe('polygon')
      expect(geom?.nodes).toHaveLength(5)
      expect(geom?.bounds?.minLng).toBeCloseTo(-122.42)
      expect(geom?.bounds?.maxLng).toBeCloseTo(-122.41)
      expect(geom?.bounds?.minLat).toBeCloseTo(37.77)
      expect(geom?.bounds?.maxLat).toBeCloseTo(37.78)
    })

    test('maps LineString full_geometry to linestring type', async () => {
      mockAxiosPost.mockResolvedValueOnce({
        data: [{
          ...baseResult,
          geom_type: 'line',
          full_geometry: {
            type: 'LineString',
            coordinates: [[-122.42, 37.77], [-122.41, 37.78], [-122.40, 37.79]],
          },
        }],
      })
      const [place] = await integration.searchPlaces('test')
      const geom = place.geometry?.value
      expect(geom?.type).toBe('linestring')
      expect(geom?.nodes).toHaveLength(3)
    })

    test('maps MultiPolygon full_geometry to multipolygon type', async () => {
      mockAxiosPost.mockResolvedValueOnce({
        data: [{
          ...baseResult,
          geom_type: 'area',
          full_geometry: {
            type: 'MultiPolygon',
            coordinates: [
              [[[-122.42, 37.77], [-122.41, 37.77], [-122.41, 37.78], [-122.42, 37.77]]],
              [[[-122.40, 37.75], [-122.39, 37.75], [-122.39, 37.76], [-122.40, 37.75]]],
            ],
          },
        }],
      })
      const [place] = await integration.searchPlaces('test')
      const geom = place.geometry?.value
      expect(geom?.type).toBe('multipolygon')
      expect(geom?.polygons).toHaveLength(2)
    })

    test('computes bounds from MultiLineString coordinates', async () => {
      mockAxiosPost.mockResolvedValueOnce({
        data: [{
          ...baseResult,
          geom_type: 'line',
          full_geometry: {
            type: 'MultiLineString',
            coordinates: [
              [[-122.42, 37.77], [-122.41, 37.78]],
              [[-122.40, 37.75], [-122.39, 37.76]],
            ],
          },
        }],
      })
      const [place] = await integration.searchPlaces('test')
      const geom = place.geometry?.value
      expect(geom?.type).toBe('linestring')
      expect(geom?.bounds?.minLng).toBeCloseTo(-122.42)
      expect(geom?.bounds?.maxLat).toBeCloseTo(37.78)
    })
  })

  describe('adaptPlace — address', () => {
    test('constructs street1 from housenumber + street', async () => {
      mockAxiosPost.mockResolvedValueOnce({
        data: [{ ...baseResult, address: { housenumber: '100', street: 'Main St' } }],
      })
      const [place] = await integration.searchPlaces('test')
      expect(place.address?.value.street1).toBe('100 Main St')
    })

    test('uses street alone when housenumber is missing', async () => {
      mockAxiosPost.mockResolvedValueOnce({
        data: [{ ...baseResult, address: { street: 'Oak Avenue', city: 'Portland' } }],
      })
      const [place] = await integration.searchPlaces('test')
      expect(place.address?.value.street1).toBe('Oak Avenue')
    })

    test('maps all address components', async () => {
      mockAxiosPost.mockResolvedValueOnce({
        data: [{
          ...baseResult,
          address: {
            housenumber: '100', street: 'Main St',
            city: 'Springfield', state: 'IL',
            postcode: '62701', country: 'US',
          },
        }],
      })
      const [place] = await integration.searchPlaces('test')
      const addr = place.address?.value
      expect(addr?.locality).toBe('Springfield')
      expect(addr?.region).toBe('IL')
      expect(addr?.postalCode).toBe('62701')
      expect(addr?.country).toBe('US')
    })

    test('sets address to null when not provided', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [baseResult] })
      const [place] = await integration.searchPlaces('test')
      expect(place.address).toBeNull()
    })
  })

  describe('adaptPlace — contact info', () => {
    test('extracts the first phone number', async () => {
      mockAxiosPost.mockResolvedValueOnce({
        data: [{ ...baseResult, phones: ['+1-800-555-0100', '+1-800-555-0101'] }],
      })
      const [place] = await integration.searchPlaces('test')
      expect(place.contactInfo.phone?.value).toBe('+1-800-555-0100')
    })

    test('sets phone to null when no phones', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [baseResult] })
      const [place] = await integration.searchPlaces('test')
      expect(place.contactInfo.phone).toBeNull()
    })

    test('extracts primary website', async () => {
      mockAxiosPost.mockResolvedValueOnce({
        data: [{ ...baseResult, websites: ['https://example.com', 'https://alt.example.com'] }],
      })
      const [place] = await integration.searchPlaces('test')
      expect(place.contactInfo.website?.value).toBe('https://example.com')
    })

    test('merges website:* sub-tag URLs into websites list', async () => {
      mockAxiosPost.mockResolvedValueOnce({
        data: [{
          ...baseResult,
          websites: ['https://example.com'],
          tags: {
            'website:menu': 'https://example.com/menu',
            'website:reservations': 'https://booking.example.com',
          },
        }],
      })
      const [place] = await integration.searchPlaces('test')
      const all = place.contactInfo.websites?.value
      expect(all).toContain('https://example.com')
      expect(all).toContain('https://example.com/menu')
      expect(all).toContain('https://booking.example.com')
    })

    test('deduplicates website:* URLs already present in primary list', async () => {
      mockAxiosPost.mockResolvedValueOnce({
        data: [{
          ...baseResult,
          websites: ['https://example.com'],
          tags: { 'website:main': 'https://example.com' },
        }],
      })
      const [place] = await integration.searchPlaces('test')
      expect(place.contactInfo.websites?.value).toHaveLength(1)
    })

    test('ignores website:* tags that are not HTTP/HTTPS URLs', async () => {
      mockAxiosPost.mockResolvedValueOnce({
        data: [{
          ...baseResult,
          websites: [],
          tags: { 'website:facebook': 'not-a-url', 'website:menu': 'https://example.com/menu' },
        }],
      })
      const [place] = await integration.searchPlaces('test')
      expect(place.contactInfo.websites?.value).toEqual(['https://example.com/menu'])
    })

    test('sets website and websites to null when no URLs anywhere', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [baseResult] })
      const [place] = await integration.searchPlaces('test')
      expect(place.contactInfo.website).toBeNull()
      expect(place.contactInfo.websites).toBeNull()
    })
  })

  describe('adaptPlace — opening hours', () => {
    test('parses opening hours from OSM hours string', async () => {
      mockAxiosPost.mockResolvedValueOnce({
        data: [{ ...baseResult, hours: 'Mo-Fr 09:00-17:00', tags: {} }],
      })
      const [place] = await integration.searchPlaces('test')
      expect(place.openingHours).not.toBeNull()
      expect(place.openingHours?.value).toBeDefined()
    })

    test('sets openingHours to null when hours are not provided', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [baseResult] })
      const [place] = await integration.searchPlaces('test')
      expect(place.openingHours).toBeNull()
    })
  })

  // ── Place summary ─────────────────────────────────────────────────────────

  describe('buildPlaceSummary', () => {
    const withTags = async (tags: Record<string, string>) => {
      mockAxiosPost.mockResolvedValueOnce({ data: [{ ...baseResult, tags }] })
      const [place] = await integration.searchPlaces('test')
      return place.summary
    }

    describe('bicycle_parking', () => {
      test('shows "Indoors" when indoor=yes', async () => {
        expect(await withTags({ amenity: 'bicycle_parking', indoor: 'yes' })).toContain('Indoors')
      })

      test('shows "Covered" when covered=yes', async () => {
        expect(await withTags({ amenity: 'bicycle_parking', covered: 'yes' })).toContain('Covered')
      })

      test('shows plural capacity', async () => {
        expect(await withTags({ amenity: 'bicycle_parking', capacity: '10' })).toContain('10 bicycles')
      })

      test('shows singular capacity', async () => {
        expect(await withTags({ amenity: 'bicycle_parking', capacity: '1' })).toContain('1 bicycle')
      })
    })

    describe('parking', () => {
      test('shows "Paid" when fee=yes', async () => {
        expect(await withTags({ amenity: 'parking', fee: 'yes' })).toContain('Paid')
      })

      test('shows "Free" when fee=no', async () => {
        expect(await withTags({ amenity: 'parking', fee: 'no' })).toContain('Free')
      })

      test('shows space count', async () => {
        expect(await withTags({ amenity: 'parking', capacity: '50' })).toContain('50 spaces')
      })

      test('shows max stay limit', async () => {
        expect(await withTags({ amenity: 'parking', maxstay: '2 hours' })).toContain('Max 2 hours')
      })
    })

    describe('toilets', () => {
      test('shows "Free" when fee=no', async () => {
        expect(await withTags({ amenity: 'toilets', fee: 'no' })).toContain('Free')
      })

      test('shows "Fee required" when fee=yes', async () => {
        expect(await withTags({ amenity: 'toilets', fee: 'yes' })).toContain('Fee required')
      })

      test('shows "Accessible" when wheelchair=yes', async () => {
        expect(await withTags({ amenity: 'toilets', wheelchair: 'yes' })).toContain('Accessible')
      })

      test('shows "Baby changing" when changing_table=yes', async () => {
        expect(await withTags({ amenity: 'toilets', changing_table: 'yes' })).toContain('Baby changing')
      })
    })

    describe('food & drink', () => {
      test('shows formatted cuisine (coffee_shop → Coffee Shop)', async () => {
        expect(await withTags({ amenity: 'cafe', cuisine: 'coffee_shop' })).toContain('Coffee Shop')
      })

      test('shows only first cuisine when multiple are listed', async () => {
        const summary = await withTags({ amenity: 'cafe', cuisine: 'coffee_shop;sandwich' })
        expect(summary).toContain('Coffee Shop')
        expect(summary).not.toContain('Sandwich')
      })

      test('shows "Outdoor seating" when outdoor_seating=yes', async () => {
        expect(await withTags({ amenity: 'restaurant', outdoor_seating: 'yes' })).toContain('Outdoor seating')
      })

      test('shows "Delivery" when delivery=yes', async () => {
        expect(await withTags({ amenity: 'fast_food', delivery: 'yes' })).toContain('Delivery')
      })
    })

    describe('fuel station', () => {
      test('shows available fuel types', async () => {
        const summary = await withTags({ amenity: 'fuel', 'fuel:diesel': 'yes', 'fuel:octane_87': 'yes' })
        expect(summary).toContain('Diesel')
        expect(summary).toContain('Regular')
      })

      test('shows EV when fuel:electric=yes', async () => {
        expect(await withTags({ amenity: 'fuel', 'fuel:electric': 'yes' })).toContain('EV')
      })
    })

    describe('charging station', () => {
      test('shows point count', async () => {
        expect(await withTags({ amenity: 'charging_station', capacity: '4' })).toContain('4 points')
      })

      test('shows "Free" when fee=no', async () => {
        expect(await withTags({ amenity: 'charging_station', fee: 'no' })).toContain('Free')
      })
    })

    describe('hotel', () => {
      test('shows star rating', async () => {
        expect(await withTags({ tourism: 'hotel', stars: '4' })).toContain('4★')
      })

      test('shows room count', async () => {
        expect(await withTags({ tourism: 'hotel', rooms: '120' })).toContain('120 rooms')
      })
    })

    describe('drinking water', () => {
      test('shows "Seasonal" when seasonal=yes', async () => {
        expect(await withTags({ amenity: 'drinking_water', seasonal: 'yes' })).toContain('Seasonal')
      })

      test('shows "Bottle fill" when bottle=yes', async () => {
        expect(await withTags({ amenity: 'drinking_water', bottle: 'yes' })).toContain('Bottle fill')
      })
    })

    test('returns null for places with no relevant summary tags', async () => {
      expect(await withTags({ amenity: 'bench' })).toBeNull()
    })

    test('returns null for places with empty tags', async () => {
      expect(await withTags({})).toBeNull()
    })
  })

  // ── HTTP request parameters ────────────────────────────────────────────────

  describe('searchPlaces', () => {
    test('POSTs to /search with semantic=true', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [] })
      await integration.searchPlaces('coffee', 37.7749, -122.4194, { radius: 1000, limit: 10 })

      expect(mockAxiosPost).toHaveBeenCalledWith(
        'http://localhost:3100/search',
        expect.objectContaining({ query: 'coffee', lat: 37.7749, lng: -122.4194, radius: 1000, limit: 10, semantic: true }),
        expect.any(Object),
      )
    })

    test('defaults limit to 20', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [] })
      await integration.searchPlaces('test')
      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ limit: 20 }),
        expect.any(Object),
      )
    })
  })

  describe('getAutocomplete', () => {
    test('POSTs to /search with semantic=false and autocomplete=true', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [] })
      await integration.getAutocomplete('lib', 37.7749, -122.4194)

      expect(mockAxiosPost).toHaveBeenCalledWith(
        'http://localhost:3100/search',
        expect.objectContaining({ query: 'lib', semantic: false, autocomplete: true }),
        expect.any(Object),
      )
    })

    test('defaults radius to 50000m and limit to 8', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [] })
      await integration.getAutocomplete('test')
      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ radius: 50000, limit: 8 }),
        expect.any(Object),
      )
    })
  })

  describe('searchByCategory', () => {
    const bounds = { north: 37.78, south: 37.77, east: -122.41, west: -122.42 }

    test('POSTs to /search with categories array', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [] })
      await integration.searchByCategory('amenity/cafe', bounds)
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'http://localhost:3100/search',
        expect.objectContaining({ categories: ['amenity/cafe'] }),
        expect.any(Object),
      )
    })

    test('computes center lat/lng from bounds midpoint', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [] })
      await integration.searchByCategory('amenity/cafe', bounds)
      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ lat: (37.78 + 37.77) / 2, lng: (-122.41 + -122.42) / 2 }),
        expect.any(Object),
      )
    })

    test('caps radius at 50km for very large bounds', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [] })
      await integration.searchByCategory('amenity/cafe', { north: 90, south: -90, east: 180, west: -180 })
      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ radius: 50000 }),
        expect.any(Object),
      )
    })

    test('passes filterTags in request body when provided', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [] })
      await integration.searchByCategory('amenity/restaurant', bounds, { filterTags: { cuisine: 'pizza' } })
      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ tags: { cuisine: 'pizza' } }),
        expect.any(Object),
      )
    })

    test('omits tags key when no filterTags provided', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [] })
      await integration.searchByCategory('amenity/cafe', bounds)
      const body = (mockAxiosPost.mock.calls[0] as any)[1]
      expect(body.tags).toBeUndefined()
    })
  })

  describe('getPlaceInfo', () => {
    test('GETs /place/{id}', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: baseResult })
      await integration.getPlaceInfo('node/123456')
      expect(mockAxiosGet).toHaveBeenCalledWith(
        'http://localhost:3100/place/node/123456',
        expect.any(Object),
      )
    })

    test('returns null on 404', async () => {
      mockAxiosGet.mockRejectedValueOnce({ response: { status: 404 } })
      expect(await integration.getPlaceInfo('node/999999')).toBeNull()
    })

    test('rethrows non-404 errors', async () => {
      mockAxiosGet.mockRejectedValueOnce({ response: { status: 500 }, message: 'Server Error' })
      await expect(integration.getPlaceInfo('node/1')).rejects.toBeDefined()
    })

    test('returns adapted place on success', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: { ...baseResult, name: 'Central Park' } })
      const place = await integration.getPlaceInfo('node/123456')
      expect(place?.name?.value).toBe('Central Park')
      expect(place?.id).toBe('osm/node/123456')
    })
  })

  describe('getContainingAreas', () => {
    test('GETs /contains with lat/lng params', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: [] })
      await integration.getContainingAreas(37.7749, -122.4194)
      expect(mockAxiosGet).toHaveBeenCalledWith(
        'http://localhost:3100/contains',
        expect.objectContaining({ params: expect.objectContaining({ lat: 37.7749, lng: -122.4194 }) }),
      )
    })

    test('includes exclude param when provided', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: [] })
      await integration.getContainingAreas(37.77, -122.41, 'relation/123')
      const params = (mockAxiosGet.mock.calls[0] as any)[1].params
      expect(params.exclude).toBe('relation/123')
    })

    test('omits exclude param when not provided', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: [] })
      await integration.getContainingAreas(37.77, -122.41)
      const params = (mockAxiosGet.mock.calls[0] as any)[1].params
      expect(params.exclude).toBeUndefined()
    })
  })

  describe('getChildren', () => {
    test('GETs /children with id and default offset/limit', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: [] })
      await integration.getChildren('relation/12345')
      expect(mockAxiosGet).toHaveBeenCalledWith(
        'http://localhost:3100/children',
        expect.objectContaining({ params: expect.objectContaining({ id: 'relation/12345', limit: 20, offset: 0 }) }),
      )
    })

    test('joins categories array as comma-separated string', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: [] })
      await integration.getChildren('relation/1', ['amenity/cafe', 'amenity/restaurant'])
      const params = (mockAxiosGet.mock.calls[0] as any)[1].params
      expect(params.categories).toBe('amenity/cafe,amenity/restaurant')
    })

    test('includes lat/lng proximity params when both provided', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: [] })
      await integration.getChildren('relation/1', undefined, 10, 0, 37.77, -122.41)
      const params = (mockAxiosGet.mock.calls[0] as any)[1].params
      expect(params.lat).toBe(37.77)
      expect(params.lng).toBe(-122.41)
    })

    test('omits lat/lng when not provided', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: [] })
      await integration.getChildren('relation/1')
      const params = (mockAxiosGet.mock.calls[0] as any)[1].params
      expect(params.lat).toBeUndefined()
      expect(params.lng).toBeUndefined()
    })
  })

  // ── API key authentication ────────────────────────────────────────────────

  describe('API key authentication', () => {
    test('adds Authorization: Bearer header when apiKey is configured', async () => {
      integration.initialize({ host: 'http://localhost:3100', apiKey: 'secret-key-123' })
      mockAxiosPost.mockResolvedValueOnce({ data: [] })
      await integration.searchPlaces('test')
      const headers = (mockAxiosPost.mock.calls[0] as any)[2].headers
      expect(headers['Authorization']).toBe('Bearer secret-key-123')
    })

    test('omits Authorization header when no apiKey', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: [] })
      await integration.searchPlaces('test')
      const headers = (mockAxiosPost.mock.calls[0] as any)[2].headers
      expect(headers['Authorization']).toBeUndefined()
    })
  })
})
