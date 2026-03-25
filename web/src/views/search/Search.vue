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
import { useCategoryStore } from '@/stores/category.store'
import { getCategoryColor } from '@/lib/place-colors'
import { useThemeStore } from '@/stores/theme.store'
import { ItemIcon } from '@/components/ui/item-icon'

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

const categoryStore = useCategoryStore()
const themeStore = useThemeStore()

// Category icon data for header
const categoryData = computed(() => {
  if (searchType.value !== 'category') return null
  return categoryStore.getCategoryById(route.query.categoryId as string) || null
})

const categoryIconName = computed(() => categoryData.value?.iconName ?? null)
const categoryIconPack = computed<'maki' | 'lucide'>(() => categoryData.value?.iconPack ?? 'lucide')

const categoryIconColor = computed(() => {
  // Primary: from route query (set when navigating from palette)
  const fromRoute = route.query.categoryIconCategory as string
  if (fromRoute) return getCategoryColor(fromRoute as any, themeStore.isDark)
  // Fallback: from category store once loaded
  if (categoryData.value?.iconCategory) {
    return getCategoryColor(categoryData.value.iconCategory as any, themeStore.isDark)
  }
  // Last resort: from first search result
  const firstResult = searchStore.searchResults[0]
  if (firstResult?.icon?.category) {
    return getCategoryColor(firstResult.icon.category, themeStore.isDark)
  }
  return getCategoryColor('default', themeStore.isDark)
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
  searchStore.setSearchType(
    searchType.value as 'text' | 'category' | 'overpass',
  )
  if (searchType.value === 'text') {
    searchStore.setSearchQuery(route.query.text as string)
  } else if (searchType.value === 'category') {
    searchStore.setSearchQuery(
      (route.query.categoryName as string) ||
        (route.query.categoryId as string),
    )
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
    searchStore.setSearchError(
      error instanceof Error ? error.message : 'Search failed',
    )
    searchStore.setSearchResults([])
  } finally {
    searchStore.setSearchLoading(false)
  }
}

onMounted(async () => {
  // Listen for search result clicks from map markers
  searchClickHandler = (event: Event) => {
    const customEvent = event as CustomEvent
    const { place } = customEvent.detail
    handleSearchResultClick(place, customEvent.detail.event)
  }

  document.addEventListener('search-result-click', searchClickHandler)

  // Ensure categories are loaded so the header icon resolves on fresh tab
  if (searchType.value === 'category') {
    categoryStore.loadCategories()
  }

  // Wait for the map to be ready (has valid bounds) before searching.
  // On a fresh tab the map initializes async — searching before bounds are
  // available causes Overpass to fail.
  if (!mapService.isMapReady.value) {
    const unwatch = watch(
      () => mapService.isMapReady.value,
      (ready) => {
        if (ready) {
          unwatch()
          performSearch()
        }
      },
    )
  } else {
    performSearch()
  }
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
  <div class="h-full flex flex-col gap-3 pt-4 px-4">
    <!-- Search Header -->
    <div
      v-if="!searchStore.isLoading || searchStore.hasResults"
      class="flex items-center gap-3"
    >
      <!-- Category icon -->
      <ItemIcon
        v-if="searchType === 'category' && categoryIconName"
        :icon="categoryIconName"
        :icon-pack="categoryIconPack"
        :custom-color="categoryIconColor"
        variant="solid"
        shape="circle"
        size="md"
      />

      <!-- Title + meta -->
      <div class="flex flex-col min-w-0">
        <h2 class="text-lg font-bold text-foreground tracking-tight leading-tight">
          <span v-if="searchType === 'category'">{{ route.query.categoryName }}</span>
          <span v-else-if="route.query.overpassQuery">Advanced Search</span>
          <span v-else>Search Results</span>
        </h2>
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            {{ searchStore.searchResults.length.toLocaleString() }}
            {{ searchStore.searchResults.length === 1 ? 'result' : 'results' }}
          </span>
          <div
            v-if="searchStore.isMapRefreshing"
            class="flex items-center gap-1 text-primary text-xs"
          >
            <div class="w-2.5 h-2.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span>Updating…</span>
          </div>
        </div>
      </div>
    </div>

    <div class="-mx-4">
      <FilterChips
        class="w-full overflow-x-auto scrollbar-hidden px-4"
        @filters-changed="handleFiltersChanged"
      />
    </div>

    <!-- Error state (only show if no existing places to display) -->
    <ErrorMessage
      v-if="
        searchStore.searchError &&
        !searchStore.isLoading &&
        !searchStore.hasResults
      "
      type="error"
      title="Search Error"
      :message="searchStore.searchError"
      button-text="Try Again"
      @action="performSearch"
    />

    <!-- Results take up remaining space -->
    <div
      v-if="searchStore.hasResults || searchStore.isLoading"
      class="flex-1 overflow-auto"
    >
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
