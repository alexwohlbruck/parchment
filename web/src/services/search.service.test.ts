/**
 * Unit tests for search service
 *
 * Tests cover:
 * - search() with autocomplete and full search
 * - searchByCategory() with bounds and maxResults
 * - API request params
 * - Error handling
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { api } from '@/lib/api'
import type { SearchResult, AutocompleteResult } from '@/types/search.types'
import type { Place } from '@/types/place.types'

// Mock the API
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

// Mock integrations store
vi.mock('@/stores/integrations.store', () => ({
  useIntegrationsStore: () => ({
    getConfigurationsForIntegration: vi.fn(() => []),
  }),
}))

const localData = vi.hoisted(() => ({
  bookmarks: [] as any[],
  recentPlaces: [] as any[],
}))
vi.mock('@/stores/library/bookmarks.store', () => ({
  useBookmarksStore: () => ({ bookmarks: localData.bookmarks }),
}))
vi.mock('@/stores/library/encrypted-points.store', () => ({
  useEncryptedPointsStore: () => ({ pointsByCollection: {} }),
}))
vi.mock('@/stores/recents.store', () => ({
  useRecentsStore: () => ({
    places: localData.recentPlaces,
    ensurePlacesHydrated: () => Promise.resolve(),
  }),
}))

// The word data is fetched from a file URL the test DOM can't load.
vi.mock('@server/lib/whatfreewords', async importOriginal => ({
  ...(await importOriginal<typeof import('@server/lib/whatfreewords')>()),
  loadWhatFreeWords: async () => ({
    wordsToLatLng: (words: string) =>
      words === 'filled.count.soap' ? { lat: 51.520847, lng: -0.195521 } : null,
    latLngToWords: () => null,
  }),
}))

// Import after mocks
import { useSearchService } from '@/services/search.service'
import { OfflineRequestError } from '@/lib/network-errors'
import { _resetConnectivityForTests, reportServerUnreachable } from '@/lib/connectivity'

describe('useSearchService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('search()', () => {
    test('calls API with correct params for autocomplete', async () => {
      const mockResults: AutocompleteResult[] = [
        { id: '1', title: 'Coffee Shop', type: 'place' },
      ]
      ;(api.get as any).mockResolvedValue({ data: { results: mockResults } })

      const service = useSearchService()
      const results = await service.search({
        query: 'coffee',
        lat: 37.7749,
        lng: -122.4194,
        radius: 5000,
        maxResults: 10,
        autocomplete: true,
      })

      expect(api.get).toHaveBeenCalledWith('/search', {
        params: {
          q: 'coffee',
          lat: '37.7749',
          lng: '-122.4194',
          radius: '5000',
          maxResults: '10',
          autocomplete: 'true',
        },
      })
      expect(results).toEqual(mockResults)
    })

    test('calls API with autocomplete=false for full search', async () => {
      const mockResults: SearchResult[] = [
        {
          id: '1',
          title: 'Coffee Shop',
          type: 'place',
          metadata: {
            place: {
              id: '1',
              externalIds: {},
              lat: 37.7749,
              lng: -122.4194,
            },
          },
        },
      ]
      ;(api.get as any).mockResolvedValue({ data: { results: mockResults } })

      const service = useSearchService()
      await service.search({
        query: 'coffee',
        lat: 37.7749,
        lng: -122.4194,
        autocomplete: false,
      })

      expect(api.get).toHaveBeenCalledWith('/search', {
        params: expect.objectContaining({
          autocomplete: 'false',
        }),
      })
    })

    test('omits empty query from params', async () => {
      ;(api.get as any).mockResolvedValue({ data: { results: [] } })

      const service = useSearchService()
      await service.search({
        query: '   ',
        lat: 37.7749,
        lng: -122.4194,
      })

      expect(api.get).toHaveBeenCalledWith('/search', {
        params: expect.not.objectContaining({
          q: expect.anything(),
        }),
      })
    })

    test('returns empty array on error', async () => {
      ;(api.get as any).mockRejectedValue(new Error('Network error'))

      const service = useSearchService()
      const results = await service.search({ query: 'coffee' })

      expect(results).toEqual([])
      expect(service.error.value).toBe('Network error')
    })

    test('sets loading state during request', async () => {
      let loadingDuringRequest = false
      ;(api.get as any).mockImplementation(async () => {
        loadingDuringRequest = service.loading.value
        return { data: { results: [] } }
      })

      const service = useSearchService()
      expect(service.loading.value).toBe(false)

      await service.search({ query: 'coffee' })

      expect(loadingDuringRequest).toBe(true)
      expect(service.loading.value).toBe(false)
    })
  })

  describe('searchByCategory()', () => {
    test('calls API with presetId and options', async () => {
      const mockPlaces: Place[] = [
        { id: '1', name: { value: 'Restaurant', sourceId: 'test', timestamp: '' } } as Place,
      ]
      ;(api.post as any).mockResolvedValue({
        data: { results: mockPlaces, totalCount: 1, executedAt: '' },
      })

      const service = useSearchService()
      const results = await service.searchByCategory('amenity-restaurant', {
        bounds: { north: 1, south: 0, east: 1, west: 0 },
        maxResults: 50,
      })

      expect(api.post).toHaveBeenCalledWith('/search/category', {
        presetId: 'amenity-restaurant',
        bounds: { north: 1, south: 0, east: 1, west: 0 },
        maxResults: 50,
      })
      expect(results).toEqual({
        results: mockPlaces,
        fieldDefinitions: [],
        hasMore: false,
      })
    })

    test('uses default maxResults when not provided', async () => {
      ;(api.post as any).mockResolvedValue({
        data: { results: [], totalCount: 0, executedAt: '' },
      })

      const service = useSearchService()
      await service.searchByCategory('amenity-cafe')

      expect(api.post).toHaveBeenCalledWith('/search/category', {
        presetId: 'amenity-cafe',
        maxResults: 30,
      })
    })

    test('throws error on API failure', async () => {
      ;(api.post as any).mockRejectedValue(new Error('API error'))

      const service = useSearchService()

      await expect(service.searchByCategory('amenity-cafe')).rejects.toThrow()
      expect(service.error.value).toBe('API error')
    })
  })

  describe('getAutocompleteSuggestions()', () => {
    test('calls search with autocomplete=true', async () => {
      const mockResults: AutocompleteResult[] = [
        { id: '1', title: 'Coffee', type: 'place' },
      ]
      ;(api.get as any).mockResolvedValue({ data: { results: mockResults } })

      const service = useSearchService()
      const results = await service.getAutocompleteSuggestions({
        query: 'cof',
        lat: 37.7749,
        lng: -122.4194,
      })

      expect(api.get).toHaveBeenCalledWith('/search', {
        params: expect.objectContaining({
          autocomplete: 'true',
        }),
      })
      expect(results).toEqual(mockResults)
    })
  })

  describe('getAutocompleteSuggestions() without a server', () => {
    beforeEach(() => {
      _resetConnectivityForTests()
      localData.bookmarks = [
        {
          id: 'b1',
          name: 'Joe’s Pizza',
          address: '7 Carmine St',
          lat: 40.7305,
          lng: -74.0021,
          icon: 'Pizza',
          iconColor: '#f00',
          externalIds: { osm: 'node/1' },
        },
      ]
      localData.recentPlaces = [
        { id: 'osm/way/2', title: 'Pizza Suprema', lat: 40.75, lng: -73.99, at: 1 },
        { id: 'osm/node/3', title: 'Katz’s Delicatessen', lat: 40.72, lng: -73.98, at: 2 },
      ]
    })

    test('answers from saved and recent places while offline, without a request', async () => {
      reportServerUnreachable()
      const results = await useSearchService().getAutocompleteSuggestions({ query: 'pizza' })

      expect(api.get).not.toHaveBeenCalled()
      expect(results.map(r => r.id)).toEqual(['osm/way/2', 'osm/node/1'])
      expect(results[1]).toMatchObject({ type: 'bookmark', title: 'Joe’s Pizza', lat: 40.7305 })
    })

    test('falls back to local matches when the request fails for lack of a connection', async () => {
      ;(api.get as any).mockRejectedValue(new OfflineRequestError({ method: 'get', url: '/search' } as any))
      const results = await useSearchService().getAutocompleteSuggestions({ query: 'katz' })
      expect(results.map(r => r.id)).toEqual(['osm/node/3'])
    })

    test('reads a coordinate query offline', async () => {
      reportServerUnreachable()
      const [result] = await useSearchService().getAutocompleteSuggestions({
        query: '(40.7148341, -73.9915242)',
      })
      expect(result).toMatchObject({
        id: 'coords/40.7148341/-73.9915242',
        lat: 40.7148341,
        lng: -73.9915242,
      })
    })

    test('finds a what3words address offline', async () => {
      reportServerUnreachable()
      const service = useSearchService()
      expect(await service.getAutocompleteSuggestions({ query: '///filled.count.soap' })).toEqual([
        expect.objectContaining({
          id: 'coords/51.520847/-0.195521',
          title: '///filled.count.soap',
          description: 'what3words',
        }),
      ])
      expect(await service.getAutocompleteSuggestions({ query: '///no.such.place' })).toEqual([])
    })
  })
})
