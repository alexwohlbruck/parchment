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
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import { SearchIcon } from 'lucide-vue-next'
import { newViewFraction } from '@/lib/map-bounds.utils'

const route = useRoute()
const router = useRouter()
const searchService = useSearchService()
const mapStore = useMapStore()
const mapService = useMapService()
const searchStore = useSearchStore()

const SIGNIFICANT_MOVEMENT_THRESHOLD = 0.3 // If camera moves to new area, refresh search results

let lastRefreshBounds: MapBounds | null = null

const { camera } = useMapCamera()

const authService = useAuthService()
const canAutoRefresh = computed(() => authService.hasPermission(PermissionId.SEARCH_AUTO_REFRESH))

// True when the map has moved enough to warrant a new search, but the user
// must manually confirm (shown as a "Search this area" button for non-premium users)
const pendingAreaSearch = ref(false)

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

/**
 * Human-readable title for the current category search.
 * Priority: explicit route query → store lookup (async) → formatted categoryId fallback.
 */
const categoryTitle = computed((): string => {
  if (route.query.categoryName) return route.query.categoryName as string
  if (categoryData.value?.name) return categoryData.value.name
  const id = route.query.categoryId as string
  if (!id) return ''
  // Format the last segment of the ID, e.g. "amenity/restaurant" → "Restaurant"
  const lastPart = id.split('/').pop() || id
  return lastPart.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
})

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

  return newViewFraction(lastRefreshBounds, bounds) > SIGNIFICANT_MOVEMENT_THRESHOLD
}

useMapListener('moveend', () => {
  if (!shouldMapRefresh(camera.value)) return

  if (canAutoRefresh.value) {
    // Premium: auto-refresh in the background
    debouncedMapRefresh(camera.value)
  } else {
    // Free tier: surface a manual "Search this area" prompt
    pendingAreaSearch.value = true
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
  pendingAreaSearch.value = false
  searchStore.setSearchLoading(true)
  searchStore.setSearchError(null)

  // Set search metadata
  searchStore.setSearchType(
    searchType.value as 'text' | 'category' | 'overpass',
  )
  if (searchType.value === 'text') {
    searchStore.setSearchQuery(route.query.text as string)
  } else if (searchType.value === 'category') {
    searchStore.setSearchQuery(categoryTitle.value)
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
          <span v-if="searchType === 'category'">{{ categoryTitle }}</span>
          <span v-else-if="route.query.overpassQuery">Advanced Search</span>
          <span v-else>Search Results</span>
        </h2>
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            {{ searchStore.searchResults.length.toLocaleString() }}
            {{ searchStore.searchResults.length === 1 ? 'result' : 'results' }}
          </span>
          <!-- Premium: auto-refresh spinner -->
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

    <!-- "Search this area" — shown when map has moved and user lacks auto-refresh -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 -translate-y-1"
    >
      <div v-if="pendingAreaSearch && !searchStore.isLoading" class="flex justify-center">
        <button
          class="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium bg-primary text-primary-foreground shadow-md hover:bg-primary/90 active:scale-95 transition-all"
          @click="performSearch"
        >
          <SearchIcon class="w-3.5 h-3.5" />
          Search this area
        </button>
      </div>
    </Transition>

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
