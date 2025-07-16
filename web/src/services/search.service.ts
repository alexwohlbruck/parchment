import { ref } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { api } from '@/lib/api'
import {
  SearchResult,
  SearchOptions,
  SearchResponse,
  AutocompleteResult,
  AutocompleteResponse,
} from '@/types/search.types'

/**
 * Place Search Service
 * Uses the server's unified search endpoint for all search functionality
 */
function placeSearchService() {
  const loading = ref(false)
  const suggestions = ref<SearchResult[] | AutocompleteResult[]>([])
  const error = ref<string | null>(null)

  /**
   * Perform a search using the server's unified search endpoint
   */
  async function search(
    options: SearchOptions,
  ): Promise<SearchResult[] | AutocompleteResult[]> {
    const {
      query = '', // Default to empty string for default suggestions
      lat,
      lng,
      radius = 10000,
      maxResults,
      autocomplete = true, // Default to autocomplete for most frontend use cases
    } = options

    loading.value = true
    error.value = null

    try {
      const params: Record<string, string | number> = {}

      // Only add query parameter if it's not empty
      if (query.trim()) {
        params.q = query
      }

      if (lat !== undefined && lng !== undefined) {
        params.lat = lat.toString()
        params.lng = lng.toString()
      }

      if (radius) {
        params.radius = radius.toString()
      }

      if (maxResults) {
        params.maxResults = maxResults.toString()
      }

      // Always pass autocomplete parameter explicitly
      params.autocomplete = autocomplete.toString()

      const response = autocomplete
        ? await api.get<AutocompleteResponse>('/search', { params })
        : await api.get<SearchResponse>('/search', { params })

      suggestions.value = response.data.results
      return response.data.results
    } catch (err) {
      console.error('Error in search:', err)
      error.value =
        err instanceof Error ? err.message : 'Unknown error occurred'
      return []
    } finally {
      loading.value = false
    }
  }

  /**
   * Get autocomplete suggestions (lightweight format)
   */
  async function getAutocompleteSuggestions(
    options: SearchOptions,
  ): Promise<AutocompleteResult[]> {
    const results = await search({ ...options, autocomplete: true })
    return results as AutocompleteResult[]
  }

  return {
    loading,
    suggestions,
    error,
    getAutocompleteSuggestions,
    search,
  }
}

export const usePlaceSearchService = createSharedComposable(placeSearchService)
