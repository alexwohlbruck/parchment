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

// Import after mocks
import { useSearchService } from './search.service'

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
      expect(results).toEqual(mockPlaces)
    })

    test('uses default maxResults when not provided', async () => {
      ;(api.post as any).mockResolvedValue({
        data: { results: [], totalCount: 0, executedAt: '' },
      })

      const service = useSearchService()
      await service.searchByCategory('amenity-cafe')

      expect(api.post).toHaveBeenCalledWith('/search/category', {
        presetId: 'amenity-cafe',
        maxResults: 100,
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
})
