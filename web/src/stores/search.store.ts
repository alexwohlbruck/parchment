import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Place } from '@/types/place.types'
import type { MapBounds } from '@/types/map.types'

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

  // Computed values
  const hasResults = computed(() => searchResults.value.length > 0)
  const isLoading = computed(() => isSearching.value || isMapRefreshing.value)
  const hitMaxResults = computed(() => {
    return lastMaxResults.value !== null && 
           lastResultCount.value >= lastMaxResults.value
  })

  // Actions
  function setSearchResults(places: Place[]) {
    searchResults.value = places
    lastResultCount.value = places.length
    searchError.value = null
  }

  function clearSearchResults() {
    searchResults.value = []
    lastResultCount.value = 0
    lastMaxResults.value = null
    searchError.value = null
    hoveredPlaceId.value = null
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

  // Helper to add a single result (for incremental loading)
  function addSearchResult(place: Place) {
    const exists = searchResults.value.find(p => p.id === place.id)
    if (!exists) {
      searchResults.value.push(place)
    }
  }

  // Helper to remove a single result
  function removeSearchResult(placeId: string) {
    const index = searchResults.value.findIndex(p => p.id === placeId)
    if (index !== -1) {
      searchResults.value.splice(index, 1)
    }
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

    // Computed
    hasResults,
    isLoading,
    hitMaxResults,

    // Actions
    setSearchResults,
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
  }
})
