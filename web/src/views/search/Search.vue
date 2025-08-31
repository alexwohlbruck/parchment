<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useMapStore } from '@/stores/map.store'
import { useMapService } from '@/services/map.service'
import { useMapCamera } from '@/composables/useMapCamera'
import { useMapListener } from '@/composables/useMapListener'
import { useDebounceFn } from '@vueuse/core'
import type { MapCamera, MapBounds } from '@/types/map.types'
import { useSearchService } from '@/services/search.service'
import { useLayersService } from '@/services/layers.service'
import type { Place } from '@/types/place.types'
import type { SearchResult } from '@/types/search.types'
import PlaceList from '@/components/place/PlaceList.vue'
import FilterChips from '@/components/map/FilterChips.vue'
import ErrorMessage from '@/components/ErrorMessage.vue'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { getPlaceRoute } from '@/lib/place.utils'

const route = useRoute()
const router = useRouter()
const searchService = useSearchService()
const mapStore = useMapStore()
const mapService = useMapService()
const layersService = useLayersService()

const hoveredPlaceId = ref<string | null>(null)

const SIGNIFICANT_MOVEMENT_THRESHOLD = 0.3 // If camera moves to new area, refresh search results
const SEARCH_RESULTS_LAYER_ID = 'search-results'
const SEARCH_RESULTS_SOURCE_ID = 'search-results-source'

let searchResultsLayer: ReturnType<
  typeof layersService.createInteractiveResultsLayer
> | null = null

let lastRefreshBounds: MapBounds | null = null

watch(hoveredPlaceId, () => {
  if (searchResultsLayer) {
    searchResultsLayer.updateHoverState(hoveredPlaceId.value)
  }
})

const places = ref<Place[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const { camera } = useMapCamera()

const isMapRefreshing = ref(false)
const isLoading = computed(() => loading.value || isMapRefreshing.value)
const searchType = computed(() => {
  if (route.query.categoryId) return 'category'
  // if (route.query.overpassQuery) return 'overpass'
  return 'text'
})

// Filter state
const activeFilters = ref({
  access: [] as string[],
  price: '' as string,
  rating: '' as number | '',
  openNow: false as boolean,
  sort: 'relevance' as string,
})

// Search results layer management

// TODO: If we are displaying max result count, we should always refresh
const debouncedMapRefresh = useDebounceFn(async (camera: MapCamera) => {
  isMapRefreshing.value = true
  try {
    await performSearch()
    lastRefreshBounds = mapService.getBounds()
  } catch (error) {
  } finally {
    isMapRefreshing.value = false
  }
}, 800)

function shouldMapRefresh(camera: MapCamera) {
  const bounds = mapService.getBounds()

  if (!lastRefreshBounds || !bounds) {
    return false
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

function updateSearchResultsLayer() {
  if (places.value.length === 0) {
    if (searchResultsLayer) {
      searchResultsLayer.remove()
      searchResultsLayer = null
    }
    return
  }

  if (!searchResultsLayer) {
    searchResultsLayer = layersService.createInteractiveResultsLayer(
      mapService.mapStrategy,
      {
        layerId: SEARCH_RESULTS_LAYER_ID,
        sourceId: SEARCH_RESULTS_SOURCE_ID,
        places: places.value,
        hoveredPlaceId: hoveredPlaceId.value,
        onPlaceClick: handleSearchResultClick,
        onPlaceHover: handleSearchResultHover,
        onPlaceLeave: handleSearchResultLeave,
      },
    )
  } else {
    searchResultsLayer.updateData(places.value, hoveredPlaceId.value)
  }
}

let currentHoveredPlaceId: string | null = null

function handleSearchResultHover(place: Place, event: MouseEvent) {
  currentHoveredPlaceId = place.id
  hoveredPlaceId.value = place.id
}

function handleSearchResultLeave(place: Place, event: MouseEvent) {
  if (hoveredPlaceId.value === place.id) {
    currentHoveredPlaceId = null
    hoveredPlaceId.value = null
  }
}

// Handle click on search result
function handleSearchResultClick(place: Place, event: any) {
  if (place?.id) {
    const placeRoute = getPlaceRoute(place.id)
    router.push(placeRoute)
  }
}

async function performSearch() {
  loading.value = true
  error.value = null

  const bounds = mapService.getBounds()
  const center = mapService.getCenter()

  if (searchType.value === 'category') {
    places.value = await searchService.searchByCategory(
      route.query.categoryId as string,
      {
        bounds: bounds || undefined,
      },
    )
  } else if (searchType.value === 'text') {
    const searchResults = await searchService.search({
      query: route.query.text as string,
      lat: center.lat,
      lng: center.lng,
      autocomplete: false,
      maxResults: 100,
    })
    // Since autocomplete is false, we should get SearchResult objects with full metadata
    places.value = (searchResults as SearchResult[])
      .filter(result => result.type === 'place')
      .map(result => result.metadata.place as unknown as Place)
    console.log('Search results:', places.value)
  }

  error.value = null
  loading.value = false
  updateSearchResultsLayer()
  lastRefreshBounds = mapService.getBounds()
}

onMounted(() => {
  performSearch()
})

onUnmounted(() => {
  if (searchResultsLayer) {
    searchResultsLayer.remove()
    searchResultsLayer = null
  }
})

// Watch for changes in places and update the layer
watch(
  places,
  () => {
    updateSearchResultsLayer()
  },
  { deep: true },
)

// Watch for map engine changes to recreate layer
watch(
  () => mapStore.settings.engine,
  () => {
    if (places.value.length > 0) {
      // Remove existing layer before recreating
      if (searchResultsLayer) {
        searchResultsLayer.remove()
        searchResultsLayer = null
      }
      // Recreate layer when engine changes
      updateSearchResultsLayer()
    }
  },
)

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
    <div v-if="!isLoading || places.length > 0" class="relative pl-2">
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
                {{ places.length.toLocaleString() }}
                {{ places.length === 1 ? 'result' : 'results' }}
              </span>
            </div>

            <div
              v-if="isMapRefreshing"
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
      v-if="error && !isLoading && places.length === 0"
      type="error"
      title="Search Error"
      :message="error"
      button-text="Try Again"
      @action="performSearch"
    />

    <!-- Results take up remaining space -->
    <div v-if="places.length > 0 || isLoading" class="flex-1 overflow-auto">
      <div class="max-w-4xl mx-auto">
        <PlaceList
          :places="places"
          :loading="isLoading"
          @place-hover="hoveredPlaceId = $event"
          @place-leave="hoveredPlaceId = null"
        />
      </div>
    </div>
  </div>
</template>
