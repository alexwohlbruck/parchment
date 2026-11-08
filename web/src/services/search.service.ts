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
import { isOffline } from '@/lib/connectivity'
import { getNetworkErrorKind, isRetriableNetworkError } from '@/lib/network-errors'
import { localAutocomplete, coordinateResult } from '@/lib/search/local-search'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useEncryptedPointsStore } from '@/stores/library/encrypted-points.store'
import { useRecentsStore } from '@/stores/recents.store'

interface AdvancedSearchResponse {
  query: string
  results: Place[]
  totalCount: number
  executedAt: string
}

interface CategorySearchOptions {
  bounds?: MapBounds
  maxResults?: number
  offset?: number
  sort?: string
  filter?: Record<string, any>
  tags?: Record<string, string>
}

interface CategoryFieldDefinition {
  id: string
  key: string
  type: string
  label: string
  placeholder?: string
  options?: Record<string, string | { title: string }>
}

interface CategorySearchResponse {
  presetId: string
  results: Place[]
  fieldDefinitions?: CategoryFieldDefinition[]
  hasMore: boolean
  executedAt: string
}

interface BrandSearchOptions {
  brandKey: string
  brandName?: string
  bounds?: MapBounds
  lat?: number
  lng?: number
  minResults?: number
  maxResults?: number
}

export interface BrandHeader {
  brandKey: string
  name: string
  wikidata: string | null
  locationCount: number | null
  category: string | null
  logoUrl?: string
  description?: string
}

interface BrandSearchResponse {
  brandKey: string
  brand: BrandHeader
  results: Place[]
  totalCount: number
  executedAt: string
}

function searchService() {
  const loading = ref(false)
  const suggestions = ref<SearchResult[] | AutocompleteResult[]>([])
  const error = ref<string | null>(null)
  const lastAdvancedResults = ref<Place[]>([])

  /** One `/search` round trip; throws on failure, unlike `search`. */
  async function requestSearch(
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
  }

  async function search(
    options: SearchOptions,
    signal?: AbortSignal,
  ): Promise<SearchResult[] | AutocompleteResult[]> {
    loading.value = true
    error.value = null

    try {
      return await requestSearch(options, signal)
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

  /**
   * Matches from data already on the device: a typed coordinate, saved
   * places (including e2ee points decrypted this session) and recent places.
   */
  async function searchLocally(options: SearchOptions): Promise<AutocompleteResult[]> {
    const coords = coordinateResult(options.query)
    if (coords) return [coords]

    const recentsStore = useRecentsStore()
    await recentsStore.ensurePlacesHydrated().catch(() => {})
    const encryptedPoints = Object.values(useEncryptedPointsStore().pointsByCollection).flat()
    const center =
      options.lat != null && options.lng != null
        ? { lat: options.lat, lng: options.lng }
        : undefined

    return localAutocomplete(
      options.query,
      {
        savedPlaces: [...useBookmarksStore().bookmarks, ...encryptedPoints],
        recentPlaces: recentsStore.places,
      },
      { center, limit: options.maxResults },
    )
  }

  /**
   * Server autocomplete, answered from local data instead when the device is
   * offline or the server can't be reached, so search keeps working.
   */
  async function getAutocompleteSuggestions(
    options: SearchOptions,
    signal?: AbortSignal,
  ): Promise<AutocompleteResult[]> {
    if (isOffline.value) return searchLocally(options)

    loading.value = true
    error.value = null
    try {
      return (await requestSearch({ ...options, autocomplete: true }, signal)) as AutocompleteResult[]
    } catch (err) {
      if (axios.isCancel(err)) return []
      error.value = err instanceof Error ? err.message : 'Unknown error occurred'
      if (isRetriableNetworkError(getNetworkErrorKind(err))) return searchLocally(options)
      console.error('Error in search:', err)
      return []
    } finally {
      loading.value = false
    }
  }

  async function searchByCategory(
    presetId: string,
    options: CategorySearchOptions = {},
  ): Promise<{ results: Place[]; fieldDefinitions: CategoryFieldDefinition[]; hasMore: boolean }> {
    loading.value = true
    error.value = null

    try {
      const response = await api.post<CategorySearchResponse>(
        '/search/category',
        {
          presetId,
          bounds: options.bounds,
          maxResults: options.maxResults || 30,
          ...(options.offset ? { offset: options.offset } : {}),
          ...(options.sort ? { sort: options.sort } : {}),
          ...(options.filter ? { filter: options.filter } : {}),
          ...(options.tags ? { tags: options.tags } : {}),
        },
      )

      return {
        results: response.data.results,
        fieldDefinitions: response.data.fieldDefinitions || [],
        hasMore: response.data.hasMore ?? false,
      }
    } catch (err) {
      console.error('Error in category search:', err)
      error.value =
        err instanceof Error ? err.message : 'Failed to execute category search'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function searchByBrand(
    options: BrandSearchOptions,
  ): Promise<{ results: Place[]; brand: BrandHeader }> {
    loading.value = true
    error.value = null

    try {
      const response = await api.post<BrandSearchResponse>('/search/brand', {
        brandKey: options.brandKey,
        ...(options.brandName ? { brandName: options.brandName } : {}),
        ...(options.bounds ? { bounds: options.bounds } : {}),
        ...(options.lat != null ? { lat: options.lat } : {}),
        ...(options.lng != null ? { lng: options.lng } : {}),
        ...(options.minResults != null ? { minResults: options.minResults } : {}),
        maxResults: options.maxResults || 100,
      })

      return {
        results: response.data.results,
        brand: response.data.brand,
      }
    } catch (err) {
      console.error('Error in brand search:', err)
      error.value =
        err instanceof Error ? err.message : 'Failed to execute brand search'
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
    searchLocally,
    searchByCategory,
    searchByBrand,
    isAdvancedSearchAvailable,
    executeOverpassQuery,
    clearAdvancedResults,
  }
}

export const useSearchService = createSharedComposable(searchService)
