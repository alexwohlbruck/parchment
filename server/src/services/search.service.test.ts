import { describe, test, expect, beforeEach, mock } from 'bun:test'

// ── Mock dependencies before imports ─────────────────────────────────────────
//   (bun:test hoists mock.module() calls above import statements)

const mockSearchBookmarks = mock(() => Promise.resolve([]))
const mockLookupPlaces = mock(() => Promise.resolve([]))
const mockSearchCategories = mock(() => [] as any[])
const mockGetCategoryById = mock((_id: string) => null as any)

mock.module('./library/bookmarks.service', () => ({
  searchBookmarks: mockSearchBookmarks,
}))

mock.module('./place.service', () => ({
  lookupPlacesByNameAndLocation: mockLookupPlaces,
}))

mock.module('./category.service', () => ({
  categoryService: {
    searchCategories: mockSearchCategories,
    getCategoryById: mockGetCategoryById,
  },
}))

const mockSearchCategoryCapability = mock(() => Promise.resolve([] as any[]))
const mockGetCachedIntegration = mock((_record: any) => null as any)
const mockGetConfiguredIntegrations = mock((_capabilityId: any) => [] as any[])

mock.module('./integrations', () => ({
  integrationManager: {
    getConfiguredIntegrationsByCapability: mockGetConfiguredIntegrations,
    getCachedIntegrationInstance: mockGetCachedIntegration,
  },
}))

// ── Import under test (after mocks) ──────────────────────────────────────────
import { search, searchByCategory } from './search.service'

// ── Test fixtures ─────────────────────────────────────────────────────────────

function makePreset(overrides: Record<string, any> = {}): any {
  return {
    id: 'amenity/cafe',
    type: 'category',
    name: 'Café',
    description: undefined,
    icon: 'maki-cafe',
    iconName: 'cafe',
    iconPack: 'maki',
    tags: { amenity: 'cafe' },
    geometry: ['point', 'area'],
    aliases: [],
    ...overrides,
  }
}

function makePlace(overrides: Record<string, any> = {}): any {
  return {
    id: 'osm/node/1',
    name: { value: 'Test Café', sourceId: 'osm', timestamp: '' },
    placeType: { value: 'Café', sourceId: 'osm', timestamp: '' },
    address: {
      value: {
        street1: '123 Main St',
        locality: 'Springfield',
        region: 'IL',
        postalCode: '62701',
      },
      sourceId: 'osm',
      timestamp: '',
    },
    geometry: {
      value: { type: 'point', center: { lat: 37.77, lng: -122.41 } },
      sourceId: 'osm',
      timestamp: '',
    },
    icon: { icon: 'coffee', iconPack: 'lucide', category: 'default' },
    tags: {},
    ...overrides,
  }
}

describe('search service', () => {
  beforeEach(() => {
    mockSearchBookmarks.mockClear()
    mockLookupPlaces.mockClear()
    mockSearchCategories.mockClear()
    mockGetCategoryById.mockClear()
    mockGetCachedIntegration.mockClear()
    mockGetConfiguredIntegrations.mockClear()
    // Safe defaults
    mockSearchCategories.mockReturnValue([])
    mockSearchBookmarks.mockResolvedValue([])
    mockLookupPlaces.mockResolvedValue([])
    mockGetConfiguredIntegrations.mockReturnValue([])
    mockGetCachedIntegration.mockReturnValue(null)
  })

  // ── convertPresetToSearchResult ───────────────────────────────────────────

  describe('convertPresetToSearchResult — raw tag filtering', () => {
    test('passes through human-readable descriptions unchanged', async () => {
      mockSearchCategories.mockReturnValue([makePreset({ description: 'A place for coffee and pastries' })])
      const resp = await search('user-1', { query: 'cafe' }) as any
      expect(resp.results[0].description).toBe('A place for coffee and pastries')
    })

    test('strips raw "key=value" OSM tag descriptions (amenity=cafe)', async () => {
      mockSearchCategories.mockReturnValue([makePreset({ description: 'amenity=cafe' })])
      const resp = await search('user-1', { query: 'cafe' }) as any
      expect(resp.results[0].description).toBeUndefined()
    })

    test('strips raw tag descriptions with underscore values (amenity=library_dropoff)', async () => {
      mockSearchCategories.mockReturnValue([makePreset({ description: 'amenity=library_dropoff' })])
      const resp = await search('user-1', { query: 'library' }) as any
      expect(resp.results[0].description).toBeUndefined()
    })

    test('strips raw natural=bay style descriptions', async () => {
      mockSearchCategories.mockReturnValue([makePreset({ description: 'natural=bay' })])
      const resp = await search('user-1', { query: 'bay' }) as any
      expect(resp.results[0].description).toBeUndefined()
    })

    test('allows descriptions with spaces (not raw tags)', async () => {
      mockSearchCategories.mockReturnValue([makePreset({ description: 'Public library with books' })])
      const resp = await search('user-1', { query: 'library' }) as any
      expect(resp.results[0].description).toBe('Public library with books')
    })

    test('undefined description stays undefined', async () => {
      mockSearchCategories.mockReturnValue([makePreset({ description: undefined })])
      const resp = await search('user-1', { query: 'cafe' }) as any
      expect(resp.results[0].description).toBeUndefined()
    })

    test('sets result type to "category" and uses preset name as title', async () => {
      mockSearchCategories.mockReturnValue([makePreset({ name: 'Library', id: 'amenity/library' })])
      const resp = await search('user-1', { query: 'library' }) as any
      expect(resp.results[0].type).toBe('category')
      expect(resp.results[0].title).toBe('Library')
      expect(resp.results[0].id).toBe('amenity/library')
    })
  })

  // ── convertPlaceToSearchResult ─────────────────────────────────────────────

  describe('convertPlaceToSearchResult — description formatting', () => {
    const searchWithPlace = async (place: any) => {
      mockLookupPlaces.mockResolvedValueOnce([place])
      const resp = await search('user-1', { query: 'test', lat: 37.77, lng: -122.41 }) as any
      return resp.results.find((r: any) => r.type === 'place')
    }

    test('formats description as "PlaceType · built address"', async () => {
      const result = await searchWithPlace(makePlace())
      expect(result?.description).toBe('Café · 123 Main St, Springfield, IL 62701')
    })

    test('uses only placeType when address is absent', async () => {
      const result = await searchWithPlace(makePlace({ address: null }))
      expect(result?.description).toBe('Café')
    })

    test('uses only address when placeType is absent', async () => {
      const result = await searchWithPlace(makePlace({ placeType: null }))
      expect(result?.description).toBe('123 Main St, Springfield, IL 62701')
    })

    test('prefers formatted address over individually built parts', async () => {
      const place = makePlace({
        address: {
          value: {
            formatted: '123 Main St, Springfield, IL 62701, USA',
            street1: 'SHOULD NOT APPEAR',
          },
          sourceId: 'osm',
          timestamp: '',
        },
      })
      const result = await searchWithPlace(place)
      expect(result?.description).toContain('USA')
      expect(result?.description).not.toContain('SHOULD NOT APPEAR')
    })

    test('combines region and postalCode into one segment', async () => {
      const result = await searchWithPlace(makePlace())
      // "IL 62701" should appear as a single segment (not "IL, 62701")
      expect(result?.description).toContain('IL 62701')
      expect(result?.description).not.toMatch(/IL,\s*62701/)
    })

    test('emits empty description when both placeType and address are absent', async () => {
      const result = await searchWithPlace(makePlace({ placeType: null, address: null }))
      expect(result?.description).toBe('')
    })

    test('sets result type to "place" and uses place name as title', async () => {
      const result = await searchWithPlace(makePlace())
      expect(result?.type).toBe('place')
      expect(result?.title).toBe('Test Café')
    })

    test('falls back to "Unknown Place" when name is null', async () => {
      const result = await searchWithPlace(makePlace({ name: null }))
      expect(result?.title).toBe('Unknown Place')
    })
  })

  // ── search orchestration ───────────────────────────────────────────────────

  describe('search — result ordering and source selection', () => {
    test('category results appear before place results', async () => {
      mockSearchCategories.mockReturnValue([makePreset()])
      mockLookupPlaces.mockResolvedValue([makePlace()])
      const resp = await search('user-1', { query: 'cafe', lat: 37.77, lng: -122.41 }) as any
      const types = resp.results.map((r: any) => r.type)
      expect(types.indexOf('category')).toBeLessThan(types.indexOf('place'))
    })

    test('skips category search when query is empty', async () => {
      await search('user-1', { query: '' })
      expect(mockSearchCategories).not.toHaveBeenCalled()
    })

    test('skips external place search when lat/lng are not provided', async () => {
      await search('user-1', { query: 'cafe' })
      expect(mockLookupPlaces).not.toHaveBeenCalled()
    })

    test('calls external place search with location when lat/lng provided', async () => {
      await search('user-1', { query: 'cafe', lat: 37.77, lng: -122.41 })
      expect(mockLookupPlaces).toHaveBeenCalledWith(
        'cafe',
        { lat: 37.77, lng: -122.41 },
        expect.any(Object),
      )
    })

    test('always searches bookmarks regardless of query', async () => {
      await search('user-1', { query: '' })
      expect(mockSearchBookmarks).toHaveBeenCalledWith('user-1', '')
    })

    test('applies maxResults limit across all combined sources', async () => {
      mockSearchCategories.mockReturnValue(
        Array.from({ length: 5 }, (_, i) => makePreset({ id: `amenity/cat${i}`, name: `Cat ${i}` })),
      )
      mockLookupPlaces.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => makePlace({ id: `osm/node/${i}` })),
      )
      const resp = await search('user-1', { query: 'test', lat: 0, lng: 0, maxResults: 3 }) as any
      expect(resp.results).toHaveLength(3)
    })

    test('totalCount reflects all results before limit is applied', async () => {
      mockSearchCategories.mockReturnValue([makePreset()])
      mockLookupPlaces.mockResolvedValue([makePlace(), makePlace({ id: 'osm/node/2' })])
      // Use non-zero lat/lng — lat:0 is falsy and would skip the external place search
      const resp = await search('user-1', { query: 'test', lat: 37.77, lng: -122.41, maxResults: 50 }) as any
      expect(resp.totalCount).toBe(3) // 1 category + 2 places
    })

    test('echoes the query in the response', async () => {
      const resp = await search('user-1', { query: 'library' }) as any
      expect(resp.query).toBe('library')
    })
  })

  describe('search — autocomplete format', () => {
    test('returns lightweight results without metadata when autocomplete=true', async () => {
      mockSearchCategories.mockReturnValue([makePreset()])
      const resp = await search('user-1', { query: 'cafe', autocomplete: true }) as any
      expect(resp.results[0]).toHaveProperty('id')
      expect(resp.results[0]).toHaveProperty('type')
      // Autocomplete results strip the metadata.place / metadata.category wrapper
      expect((resp.results[0] as any).metadata).toBeUndefined()
    })

    test('includes category metadata (tags) in autocomplete category results', async () => {
      mockSearchCategories.mockReturnValue([makePreset({ tags: { amenity: 'cafe' } })])
      const resp = await search('user-1', { query: 'cafe', autocomplete: true }) as any
      expect(resp.results[0].category?.tags).toEqual({ amenity: 'cafe' })
    })

    test('includes lat/lng coordinates in autocomplete place results', async () => {
      mockLookupPlaces.mockResolvedValue([makePlace()])
      const resp = await search('user-1', { query: 'test', lat: 37.77, lng: -122.41, autocomplete: true }) as any
      const placeResult = resp.results.find((r: any) => r.type === 'place')
      expect(placeResult?.lat).toBe(37.77)
      expect(placeResult?.lng).toBe(-122.41)
    })
  })

  describe('search — bookmark results', () => {
    test('includes bookmark results with type "bookmark"', async () => {
      mockSearchBookmarks.mockResolvedValue([{
        id: 'bm-1', name: 'Home', presetType: 'home',
        lat: 37.77, lng: -122.41, icon: 'Home', iconColor: '#ff0000',
      }])
      const resp = await search('user-1', { query: 'home' }) as any
      const bm = resp.results.find((r: any) => r.type === 'bookmark')
      expect(bm).toBeDefined()
      expect(bm.title).toBe('Home')
    })

    test('uses preset icon for home/work/school bookmarks', async () => {
      mockSearchBookmarks.mockResolvedValue([{
        id: 'bm-1', name: 'My Office', presetType: 'work',
        lat: 0, lng: 0, icon: 'star', iconColor: '#000',
      }])
      const resp = await search('user-1', { query: 'work' }) as any
      const bm = resp.results.find((r: any) => r.type === 'bookmark')
      expect(bm.icon).toBe('Building')
    })

    test('sets description to capitalized preset type for preset bookmarks', async () => {
      mockSearchBookmarks.mockResolvedValue([{
        id: 'bm-1', name: 'Our House', presetType: 'home',
        lat: 0, lng: 0, icon: 'Home', iconColor: '#000',
      }])
      const resp = await search('user-1', { query: 'home' }) as any
      const bm = resp.results.find((r: any) => r.type === 'bookmark')
      expect(bm.description).toBe('Home')
    })

    test('uses "Bookmarked • address" description for non-preset bookmarks', async () => {
      mockSearchBookmarks.mockResolvedValue([{
        id: 'bm-1', name: 'Coffee Shop', presetType: null,
        lat: 0, lng: 0, icon: 'star', iconColor: '#000',
        address: '42 Oak St',
      }])
      const resp = await search('user-1', { query: 'coffee' }) as any
      const bm = resp.results.find((r: any) => r.type === 'bookmark')
      expect(bm.description).toBe('Bookmarked • 42 Oak St')
    })
  })

  // ── derivePresetFilter / searchByCategory ──────────────────────────────────

  describe('searchByCategory — preset ID derivation', () => {
    const bounds = { north: 37.78, south: 37.77, east: -122.41, west: -122.42 }

    const setupCapability = () => {
      const mockCapability = {
        searchByCategory: mock(() => Promise.resolve([])),
      }
      mockGetConfiguredIntegrations.mockReturnValue([{ id: 'test-integration' }])
      mockGetCachedIntegration.mockReturnValue({
        integrationId: 'barrelman',
        capabilities: { searchCategory: mockCapability },
      })
      return mockCapability
    }

    test('top-level preset: passes same ID with no filterTags', async () => {
      const cap = setupCapability()
      // getCategoryById returns the preset (but result unused for top-level)
      mockGetCategoryById.mockReturnValue({ tags: { amenity: 'restaurant' } })

      await searchByCategory('amenity/restaurant', { bounds })

      expect(cap.searchByCategory).toHaveBeenCalledWith(
        'amenity/restaurant',
        bounds,
        expect.objectContaining({ filterTags: undefined }),
      )
    })

    test('sub-preset (3 parts): passes parent ID and diff tags as filterTags', async () => {
      const cap = setupCapability()
      // First call: full sub-preset tags
      mockGetCategoryById.mockReturnValueOnce({ tags: { amenity: 'restaurant', cuisine: 'pizza' } })
      // Second call: parent preset tags
      mockGetCategoryById.mockReturnValueOnce({ tags: { amenity: 'restaurant' } })

      await searchByCategory('amenity/restaurant/pizza', { bounds })

      expect(cap.searchByCategory).toHaveBeenCalledWith(
        'amenity/restaurant',
        bounds,
        expect.objectContaining({ filterTags: { cuisine: 'pizza' } }),
      )
    })

    test('sub-preset with multiple diff tags passes all extra tags', async () => {
      const cap = setupCapability()
      mockGetCategoryById
        .mockReturnValueOnce({ tags: { amenity: 'restaurant', cuisine: 'sushi', delivery: 'yes' } })
        .mockReturnValueOnce({ tags: { amenity: 'restaurant' } })

      await searchByCategory('amenity/restaurant/sushi', { bounds })

      const filterTags = (cap.searchByCategory.mock.calls[0] as any)[2].filterTags
      expect(filterTags).toMatchObject({ cuisine: 'sushi', delivery: 'yes' })
    })

    test('returns empty array when no integration is configured', async () => {
      mockGetConfiguredIntegrations.mockReturnValue([])
      expect(await searchByCategory('amenity/cafe', { bounds })).toEqual([])
    })

    test('returns empty array when presetId is empty', async () => {
      expect(await searchByCategory('', { bounds })).toEqual([])
    })
  })
})
