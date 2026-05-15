import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Place } from '@/types/place.types'
import type { MapBounds } from '@/types/map.types'
import type { ChipOption } from '@/components/ui/chip'
import { useMapStore } from '@/stores/map.store'
import { useGeolocationService } from '@/services/geolocation.service'
import {
  FILTER_DEFINITIONS,
  SORT_DEFINITIONS,
  generateFiltersFromFields,
  type FilterDef,
  type SortDef,
  type SortContext,
  type FieldDefinition,
} from '@/config/search-filters'

function resolveMapCenter(center: any): [number, number] {
  if (Array.isArray(center)) return [center[0], center[1]]
  if (center?.lng != null) return [center.lng, center.lat]
  if (center?.lon != null) return [center.lon, center.lat]
  return [0, 0]
}

export const useSearchStore = defineStore('search', () => {
  // Core search state
  const searchResults = ref<Place[]>([])
  const isSearching = ref(false)
  const isMapRefreshing = ref(false)
  const searchError = ref<string | null>(null)
  const hoveredPlaceId = ref<string | null>(null)

  // Search metadata
  const searchQuery = ref<string | null>(null)
  const searchType = ref<'text' | 'category' | 'overpass'>('text')
  const lastSearchBounds = ref<MapBounds | null>(null)
  const lastMaxResults = ref<number | null>(null)
  const lastResultCount = ref<number>(0)

  // ── Filter / Sort / Search context state ────────────────────────────────
  const filters = ref<Record<string, any>>({})
  const sortBy = ref<string>('relevance')
  const categoryFields = ref<FieldDefinition[]>([])
  const searchContext = ref<'map' | 'nearby'>('map')

  // Computed values
  const hasResults = computed(() => searchResults.value.length > 0)
  const isLoading = computed(() => isSearching.value || isMapRefreshing.value)
  const hitMaxResults = computed(() => {
    return lastMaxResults.value !== null &&
           lastResultCount.value >= lastMaxResults.value
  })

  // ── All filter defs (hardcoded + auto-generated from category fields) ──
  const allFilterDefs = computed<FilterDef[]>(() => [
    ...FILTER_DEFINITIONS,
    ...generateFiltersFromFields(categoryFields.value),
  ])

  // ── Available filters & sorts based on current result set ──────────────
  const activeFilterDefs = computed<FilterDef[]>(() =>
    allFilterDefs.value.filter(def => def.isAvailable(searchResults.value)),
  )

  function getSortContext(): SortContext {
    const mapStore = useMapStore()
    const geo = useGeolocationService()
    const mapCenter = resolveMapCenter(mapStore.mapCamera.center)
    const ll = geo.lngLat.value
    return {
      mapCenter,
      userLocation: ll ? [ll.lng, ll.lat] : null,
    }
  }

  const activeSortDefs = computed<SortDef[]>(() => {
    const ctx = getSortContext()
    return SORT_DEFINITIONS.filter(def => def.isAvailable(searchResults.value, ctx))
  })

  const dynamicFilterOptions = computed<Record<string, ChipOption[]>>(() => {
    const options: Record<string, ChipOption[]> = {}
    for (const def of activeFilterDefs.value) {
      if (def.getOptions) {
        options[def.id] = def.getOptions(searchResults.value)
      }
    }
    return options
  })

  // ── Filtered & sorted results ──────────────────────────────────────────
  const filteredSearchResults = computed<Place[]>(() => {
    const defs = allFilterDefs.value
    let results = searchResults.value.filter(place =>
      defs.every(def => {
        const value = filters.value[def.id] ?? def.defaultValue
        return def.match(place, value)
      }),
    )

    const sortDef = SORT_DEFINITIONS.find(s => s.id === sortBy.value)
    if (sortDef && sortDef.id !== 'relevance') {
      const ctx = getSortContext()
      // When searching nearby, use user location as the distance reference
      if (sortDef.id === 'distance' && searchContext.value === 'nearby' && ctx.userLocation) {
        ctx.mapCenter = ctx.userLocation
      }
      results = [...results].sort((a, b) => sortDef.compare(a, b, ctx))
    }

    return results
  })

  const hasActiveFilters = computed(() =>
    allFilterDefs.value.some(def => {
      const value = filters.value[def.id]
      if (value === undefined || value === null) return false
      if (value === def.defaultValue) return false
      if (Array.isArray(value) && value.length === 0) return false
      return true
    }) || sortBy.value !== 'relevance',
  )

  const serverFilterParams = computed(() => {
    const filterObj: Record<string, any> = {}
    const tagsObj: Record<string, string> = {}
    for (const def of allFilterDefs.value) {
      const value = filters.value[def.id] ?? def.defaultValue
      const serverFilter = def.toServerFilter?.(value)
      if (!serverFilter) continue
      for (const [k, v] of Object.entries(serverFilter)) {
        if (k.startsWith('tag:')) {
          tagsObj[k.slice(4)] = v as string
        } else {
          filterObj[k] = v
        }
      }
    }
    const sortDef = SORT_DEFINITIONS.find(s => s.id === sortBy.value)
    return {
      sort: sortDef?.serverValue || undefined,
      filter: Object.keys(filterObj).length > 0 ? filterObj : undefined,
      tags: Object.keys(tagsObj).length > 0 ? tagsObj : undefined,
    }
  })

  // ── Actions ────────────────────────────────────────────────────────────
  function setSearchResults(places: Place[]) {
    searchResults.value = places
    lastResultCount.value = places.length
    searchError.value = null
  }

  function setCategoryFields(fields: FieldDefinition[]) {
    categoryFields.value = fields
  }

  function clearSearchResults() {
    searchResults.value = []
    lastResultCount.value = 0
    lastMaxResults.value = null
    searchError.value = null
    hoveredPlaceId.value = null
    categoryFields.value = []
    resetFilters()
  }

  function setSearchLoading(loading: boolean) {
    isSearching.value = loading
  }

  function setMapRefreshing(refreshing: boolean) {
    isMapRefreshing.value = refreshing
  }

  function setSearchError(error: string | null) {
    searchError.value = error
  }

  function setHoveredPlace(placeId: string | null) {
    hoveredPlaceId.value = placeId
  }

  function setSearchQuery(query: string | null) {
    searchQuery.value = query
  }

  function setSearchType(type: 'text' | 'category' | 'overpass') {
    searchType.value = type
  }

  function setLastSearchBounds(bounds: MapBounds | null) {
    lastSearchBounds.value = bounds
  }

  function setLastMaxResults(maxResults: number | null) {
    lastMaxResults.value = maxResults
  }

  function addSearchResult(place: Place) {
    const exists = searchResults.value.find(p => p.id === place.id)
    if (!exists) {
      searchResults.value.push(place)
    }
  }

  function removeSearchResult(placeId: string) {
    const index = searchResults.value.findIndex(p => p.id === placeId)
    if (index !== -1) {
      searchResults.value.splice(index, 1)
    }
  }

  function setFilter(id: string, value: any) {
    filters.value = { ...filters.value, [id]: value }
  }

  function setSortBy(id: string) {
    sortBy.value = id
  }

  function setSearchContext(ctx: 'map' | 'nearby') {
    searchContext.value = ctx
  }

  function resetFilters() {
    filters.value = {}
    sortBy.value = 'relevance'
  }

  return {
    // State
    searchResults,
    isSearching,
    isMapRefreshing,
    searchError,
    hoveredPlaceId,
    searchQuery,
    searchType,
    lastSearchBounds,
    lastMaxResults,
    lastResultCount,
    filters,
    sortBy,
    categoryFields,
    searchContext,

    // Computed
    hasResults,
    isLoading,
    hitMaxResults,
    activeFilterDefs,
    activeSortDefs,
    dynamicFilterOptions,
    filteredSearchResults,
    hasActiveFilters,
    serverFilterParams,

    // Actions
    setSearchResults,
    setCategoryFields,
    clearSearchResults,
    setSearchLoading,
    setMapRefreshing,
    setSearchError,
    setHoveredPlace,
    setSearchQuery,
    setSearchType,
    setLastSearchBounds,
    setLastMaxResults,
    addSearchResult,
    removeSearchResult,
    setFilter,
    setSortBy,
    setSearchContext,
    resetFilters,
  }
})
