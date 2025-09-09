<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useMapStore } from '@/stores/map.store'
import { useSearchStore } from '@/stores/search.store'
import { useMapService } from '@/services/map.service'
import { useMapCamera } from '@/composables/useMapCamera'
import { useMapListener } from '@/composables/useMapListener'
import { useDebounceFn } from '@vueuse/core'
import type { MapCamera, MapBounds } from '@/types/map.types'
import { useSearchService } from '@/services/search.service'
import type { Place } from '@/types/place.types'
import type { SearchResult } from '@/types/search.types'
import PlaceList from '@/components/place/PlaceList.vue'
import FilterChips from '@/components/map/FilterChips.vue'
import ErrorMessage from '@/components/ErrorMessage.vue'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { getPlaceRoute } from '@/lib/place.utils'
import { storeToRefs } from 'pinia'

const route = useRoute()
const router = useRouter()
const searchService = useSearchService()
const mapStore = useMapStore()
const mapService = useMapService()
const searchStore = useSearchStore()

const SIGNIFICANT_MOVEMENT_THRESHOLD = 0.3 // If camera moves to new area, refresh search results

let lastRefreshBounds: MapBounds | null = null

const { camera } = useMapCamera()

const searchType = computed(() => {
  if (route.query.categoryId) return 'category'
  // if (route.query.overpassQuery) return 'overpass'
  return 'text'
})

// Note: Using searchStore directly in template due to TypeScript complexity with storeToRefs

// Event listener reference for cleanup
let searchClickHandler: ((event: Event) => void) | null = null

// Filter state
const activeFilters = ref({
  access: [] as string[],
  price: '' as string,
  rating: '' as number | '',
  openNow: false as boolean,
  sort: 'relevance' as string,
})

// Search management

const debouncedMapRefresh = useDebounceFn(async (camera: MapCamera) => {
  searchStore.setMapRefreshing(true)
  try {
    await performSearch()
    lastRefreshBounds = mapService.getBounds()
  } catch (error) {
  } finally {
    searchStore.setMapRefreshing(false)
  }
}, 800)

function shouldMapRefresh(camera: MapCamera) {
  const bounds = mapService.getBounds()

  if (!lastRefreshBounds || !bounds) {
    return false
  }

  // Force refresh if the last query returned the maximum number of results
  // This indicates there may be more results available in the current area
  if (searchStore.hitMaxResults) {
    return true
  }

  function calculateBoundsArea(bounds: MapBounds) {
    const width = Math.abs(bounds.east - bounds.west)
    const height = Math.abs(bounds.north - bounds.south)
    return width * height
  }

  function calculateIntersectionArea(bounds1: MapBounds, bounds2: MapBounds) {
    // Check if bounds overlap at all
    if (
      bounds1.east < bounds2.west ||
      bounds1.west > bounds2.east ||
      bounds1.north < bounds2.south ||
      bounds1.south > bounds2.north
    ) {
      return 0
    }

    const intersection = {
      north: Math.min(bounds1.north, bounds2.north),
      south: Math.max(bounds1.south, bounds2.south),
      east: Math.min(bounds1.east, bounds2.east),
      west: Math.max(bounds1.west, bounds2.west),
    }
    return calculateBoundsArea(intersection)
  }

  const currentArea = calculateBoundsArea(bounds)
  const intersectionArea = calculateIntersectionArea(lastRefreshBounds, bounds)

  const newArea = currentArea - intersectionArea

  const newViewPercentage = newArea / currentArea

  return newViewPercentage > SIGNIFICANT_MOVEMENT_THRESHOLD
}

useMapListener('moveend', () => {
  if (shouldMapRefresh(camera.value)) {
    debouncedMapRefresh(camera.value)
  }
})

// Handle click on search result from map markers
function handleSearchResultClick(place: Place, event: any) {
  if (place?.id) {
    const placeRoute = getPlaceRoute(place.id)
    router.push(placeRoute)
  }
}

async function performSearch() {
  searchStore.setSearchLoading(true)
  searchStore.setSearchError(null)

  // Set search metadata
  searchStore.setSearchType(searchType.value as 'text' | 'category' | 'overpass')
  if (searchType.value === 'text') {
    searchStore.setSearchQuery(route.query.text as string)
  } else if (searchType.value === 'category') {
    searchStore.setSearchQuery(route.query.categoryName as string || route.query.categoryId as string)
  }

  const bounds = mapService.getBounds()
  const center = mapService.getCenter()

  try {
    let places: Place[] = []
    const maxResults = 100

    // Track the max results in the search store
    searchStore.setLastMaxResults(maxResults)

    if (searchType.value === 'category') {
      places = await searchService.searchByCategory(
        route.query.categoryId as string,
        {
          bounds: bounds || undefined,
          maxResults,
        },
      )
    } else if (searchType.value === 'text') {
      const searchResults = await searchService.search({
        query: route.query.q as string,
        lat: center.lat,
        lng: center.lng,
        autocomplete: false,
        maxResults,
      })
      // Since autocomplete is false, we should get SearchResult objects with full metadata
      places = (searchResults as SearchResult[])
        .filter(result => result.type === 'place')
        .map(result => result.metadata.place as unknown as Place)
      console.log('Search results:', places)
    }

    // Update the search store with results - this will automatically update the map layer
    searchStore.setSearchResults(places)
    searchStore.setLastSearchBounds(bounds)
    lastRefreshBounds = bounds
  } catch (error) {
    console.error('Search error:', error)
    searchStore.setSearchError(error instanceof Error ? error.message : 'Search failed')
    searchStore.setSearchResults([])
  } finally {
    searchStore.setSearchLoading(false)
  }
}

onMounted(() => {
  // Listen for search result clicks from map markers
  searchClickHandler = (event: Event) => {
    const customEvent = event as CustomEvent
    const { place } = customEvent.detail
    handleSearchResultClick(place, customEvent.detail.event)
  }
  
  document.addEventListener('search-result-click', searchClickHandler)

  performSearch()
})

onUnmounted(() => {
  // Clear search results when leaving the page
  // This will automatically hide the search results layer and clear its data
  // via the reactive watchers in the layers service
  searchStore.clearSearchResults()
  
  // Remove event listener
  if (searchClickHandler) {
    document.removeEventListener('search-result-click', searchClickHandler)
    searchClickHandler = null
  }
})

watch(
  () => route.query,
  () => {
    performSearch()
  },
  { deep: true },
)

// Handle filter changes
function handleFiltersChanged(filters: {
  access: string[]
  price: string
  rating: number | ''
  openNow: boolean
  sort: string
}) {
  activeFilters.value = filters
  console.log('Filters changed:', filters)
  // TODO: Apply filters to places or re-fetch with filters
  // For now, just log the filter changes
}
</script>

<template>
  <div class="h-full flex flex-col px-3 pt-4 gap-2">
    <!-- Search Header -->
    <div v-if="!searchStore.isLoading || searchStore.hasResults" class="relative pl-2">
      <div class="">
        <!-- Main Title -->
        <div class="space-y-1">
          <h2
            class="text-lg sm:text-xl font-bold text-foreground tracking-tight"
          >
            <span v-if="searchType === 'category'">
              {{ route.query.categoryName }}
            </span>
            <span v-else-if="route.query.overpassQuery"> Advanced Search </span>
            <span v-else> Search Results </span>
          </h2>
        </div>

        <!-- Results Count and Status -->
        <div
          class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
        >
          <div class="flex flex-col sm:flex-row sm:items-center gap-2">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-foreground">
                {{ searchStore.searchResults.length.toLocaleString() }}
                {{ searchStore.searchResults.length === 1 ? 'result' : 'results' }}
              </span>
            </div>

            <div
              v-if="searchStore.isMapRefreshing"
              class="flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary rounded-full text-xs"
            >
              <div
                class="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin"
              ></div>
              <span class="font-medium">Updating...</span>
            </div>
          </div>

          <!-- Mobile category context -->
          <div v-if="searchType === 'category'" class="sm:hidden">
            <span class="text-xs text-muted-foreground"
              >in current map area</span
            >
          </div>
        </div>
      </div>
    </div>

    <div class="-mx-3">
      <FilterChips
        class="w-full overflow-x-auto scrollbar-hidden px-3"
        @filters-changed="handleFiltersChanged"
      />
    </div>

    <!-- Error state (only show if no existing places to display) -->
    <ErrorMessage
      v-if="searchStore.searchError && !searchStore.isLoading && !searchStore.hasResults"
      type="error"
      title="Search Error"
      :message="searchStore.searchError"
      button-text="Try Again"
      @action="performSearch"
    />

    <!-- Results take up remaining space -->
    <div v-if="searchStore.hasResults || searchStore.isLoading" class="flex-1 overflow-auto">
      <div class="max-w-4xl mx-auto">
        <PlaceList
          :places="searchStore.searchResults"
          :loading="searchStore.isLoading"
          @place-hover="searchStore.setHoveredPlace($event)"
          @place-leave="searchStore.setHoveredPlace(null)"
        />
      </div>
    </div>
  </div>
</template>
