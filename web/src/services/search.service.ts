import { ref } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import axios from 'axios'
import { api } from '@/lib/api'
import {
  SearchResult,
  SearchOptions,
  SearchResponse,
  AutocompleteResult,
  AutocompleteResponse,
} from '@/types/search.types'
import type { Place } from '@/types/place.types'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { IntegrationId } from '@server/types/integration.types'
import { MapBounds } from '@/types/map.types'

interface AdvancedSearchResponse {
  query: string
  results: Place[]
  totalCount: number
  executedAt: string
}

interface CategorySearchOptions {
  bounds?: MapBounds
  maxResults?: number
}

interface CategorySearchResponse {
  presetId: string
  results: Place[]
  totalCount: number
  executedAt: string
}

interface RouteSearchOptions {
  query?: string
  buffer?: number
  categories?: string[]
  tags?: Record<string, string>
  limit?: number
  semantic?: boolean
  autocomplete?: boolean
}

interface RouteSearchResponse {
  route: any
  results: Place[]
  totalCount: number
  executedAt: string
}

function searchService() {
  const loading = ref(false)
  const suggestions = ref<SearchResult[] | AutocompleteResult[]>([])
  const error = ref<string | null>(null)
  const lastAdvancedResults = ref<Place[]>([])

  async function search(
    options: SearchOptions,
    signal?: AbortSignal,
  ): Promise<SearchResult[] | AutocompleteResult[]> {
    const {
      query = '',
      lat,
      lng,
      radius = 10000,
      maxResults,
      autocomplete = true,
    } = options

    loading.value = true
    error.value = null

    try {
      const params: Record<string, string | number> = {}

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

      params.autocomplete = autocomplete.toString()

      const response = autocomplete
        ? await api.get<AutocompleteResponse>('/search', { params, signal })
        : await api.get<SearchResponse>('/search', { params, signal })

      suggestions.value = response.data.results
      return response.data.results
    } catch (err) {
      if (axios.isCancel(err)) return []
      console.error('Error in search:', err)
      error.value =
        err instanceof Error ? err.message : 'Unknown error occurred'
      return []
    } finally {
      loading.value = false
    }
  }

  async function getAutocompleteSuggestions(
    options: SearchOptions,
    signal?: AbortSignal,
  ): Promise<AutocompleteResult[]> {
    const results = await search({ ...options, autocomplete: true }, signal)
    return results as AutocompleteResult[]
  }

  async function searchByCategory(
    presetId: string,
    options: CategorySearchOptions = {},
  ): Promise<Place[]> {
    loading.value = true
    error.value = null

    try {
      const response = await api.post<CategorySearchResponse>(
        '/search/category',
        {
          presetId,
          bounds: options.bounds,
          maxResults: options.maxResults || 100,
        },
      )

      return response.data.results
    } catch (err) {
      console.error('Error in category search:', err)
      error.value =
        err instanceof Error ? err.message : 'Failed to execute category search'
      throw err
    } finally {
      loading.value = false
    }
  }

  function isAdvancedSearchAvailable(): boolean {
    const integrationsStore = useIntegrationsStore()
    const overpassConfigs = integrationsStore.getConfigurationsForIntegration(
      IntegrationId.OVERPASS,
    )
    return overpassConfigs.length > 0
  }

  async function executeOverpassQuery(
    query: string,
    maxResults = 100,
  ): Promise<Place[]> {
    if (!isAdvancedSearchAvailable()) {
      throw new Error(
        'Advanced search is not available. Overpass integration is not configured.',
      )
    }

    loading.value = true
    error.value = null

    try {
      console.log('Executing Overpass query:', query.substring(0, 100) + '...')

      const response = await api.post<AdvancedSearchResponse>(
        '/search/advanced',
        {
          query,
          maxResults,
        },
      )

      lastAdvancedResults.value = response.data.results
      console.log(
        `Overpass query returned ${response.data.results.length} places`,
      )

      return response.data.results
    } catch (err) {
      console.error('Error executing Overpass query:', err)
      error.value =
        err instanceof Error ? err.message : 'Failed to execute Overpass query'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function searchAlongRoute(
    route: { type: 'LineString'; coordinates: number[][] },
    options: RouteSearchOptions = {},
  ): Promise<Place[]> {
    loading.value = true
    error.value = null

    try {
      const response = await api.post<RouteSearchResponse>(
        '/search/route',
        { route, ...options },
      )

      return response.data.results
    } catch (err) {
      console.error('Error in route search:', err)
      error.value =
        err instanceof Error ? err.message : 'Failed to execute route search'
      throw err
    } finally {
      loading.value = false
    }
  }

  function clearAdvancedResults(): void {
    lastAdvancedResults.value = []
    error.value = null
  }

  return {
    loading,
    suggestions,
    error,
    lastAdvancedResults,
    getAutocompleteSuggestions,
    search,
    searchByCategory,
    searchAlongRoute,
    isAdvancedSearchAvailable,
    executeOverpassQuery,
    clearAdvancedResults,
  }
}

export const useSearchService = createSharedComposable(searchService)
