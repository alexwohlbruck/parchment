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
import type { Place } from '@/types/place.types'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { IntegrationId } from '@server/types/integration.types'

interface AdvancedSearchResponse {
  query: string
  results: Place[]
  totalCount: number
  executedAt: string
}

interface AdvancedSearchMethods {
  availableMethods: string[]
  overpassAvailable: boolean
}

function placeSearchService() {
  const loading = ref(false)
  const suggestions = ref<SearchResult[] | AutocompleteResult[]>([])
  const error = ref<string | null>(null)
  const lastAdvancedResults = ref<Place[]>([])

  async function search(
    options: SearchOptions,
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

  async function getAutocompleteSuggestions(
    options: SearchOptions,
  ): Promise<AutocompleteResult[]> {
    const results = await search({ ...options, autocomplete: true })
    return results as AutocompleteResult[]
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
    isAdvancedSearchAvailable,
    executeOverpassQuery,
    clearAdvancedResults,
  }
}

export const usePlaceSearchService = createSharedComposable(placeSearchService)
