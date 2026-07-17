<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { useSearchStore } from '@/stores/search.store'
import { useMapService } from '@/services/map.service'
import { useMapCamera } from '@/composables/useMapCamera'
import { useMapListener } from '@/composables/useMapListener'
import { useDebounceFn } from '@vueuse/core'
import type { MapCamera, MapBounds } from '@/types/map.types'
import { useSearchService, type BrandHeader } from '@/services/search.service'
import type { Place } from '@/types/place.types'
import type { SearchResult } from '@/types/search.types'
import PlaceList from '@/components/place/PlaceList.vue'
import FilterChips from '@/components/map/FilterChips.vue'
import ErrorMessage from '@/components/ErrorMessage.vue'
import { useRouter } from 'vue-router'
import { getPlaceRoute } from '@/lib/place.utils'
import { usePlaceService } from '@/services/place.service'
import { useRecentsStore } from '@/stores/recents.store'
import { useCategoryStore } from '@/stores/category.store'
import { getCategoryColor } from '@/lib/place-colors'
import { useThemeStore } from '@/stores/theme.store'
import { ItemIcon } from '@/components/ui/item-icon'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import { newViewFraction } from '@/lib/map-bounds.utils'
import { useGeolocationService } from '@/services/geolocation.service'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const searchService = useSearchService()
const mapService = useMapService()
const searchStore = useSearchStore()
const { setPartialPlace } = usePlaceService()

const geolocationService = useGeolocationService()

const SIGNIFICANT_MOVEMENT_THRESHOLD = 0.3 // If camera moves to new area, refresh search results
const NEARBY_RADIUS_KM = 5
// Brand browse loads many nearby locations (so panning/zooming reveals them),
// but the camera frames only the nearest handful — a big chain (e.g. Target)
// has hundreds, and framing them all would zoom out to the whole metro.
const BRAND_MAX_RESULTS = 100 // how many locations to load + plot as markers
const BRAND_FIT_COUNT = 12 // how many of the nearest to frame the camera around

// Category results load one page at a time and paginate as the user scrolls.
const CATEGORY_PAGE_SIZE = 30
// When a fresh category search comes back with fewer than CATEGORY_MIN_RESULTS
// inside the viewport, the server has widened a thin category to the nearest
// matches beyond it — frame the camera to the nearest CATEGORY_FIT_COUNT so the
// user actually sees them (they'd otherwise be off-screen). Keep in sync with
// the server widen threshold (barrelman-integration.searchByCategory).
const CATEGORY_MIN_RESULTS = 6
const CATEGORY_FIT_COUNT = 12

let lastRefreshBounds: MapBounds | null = null
// While a programmatic camera move is in flight (e.g. the brand browse framing
// its results), moveend events must NOT trigger an auto-refresh — otherwise the
// fit → moveend → refresh → fit cycle loops forever (each fit adds padding,
// widening the view and pulling in more results). Epoch-ms deadline; moveends
// before it adopt the fitted view as the baseline instead of re-searching.
let programmaticMoveUntil = 0
let suppressUrlSync = false
let filtersRestored = false

// ── URL ↔ filter/sort sync ──────────────────────────────────────────────

function filtersToQuery(): Record<string, string | undefined> {
  const q: Record<string, string | undefined> = {}

  if (searchStore.sortBy !== 'relevance') {
    q.sort = searchStore.sortBy
  }

  for (const def of searchStore.activeFilterDefs) {
    const value = searchStore.filters[def.id]
    if (value === undefined || value === null) continue
    if (value === def.defaultValue) continue
    if (Array.isArray(value) && value.length === 0) continue
    if (def.type === 'toggle') {
      q[`f.${def.id}`] = '1'
    } else if (Array.isArray(value)) {
      q[`f.${def.id}`] = value.join(',')
    } else {
      q[`f.${def.id}`] = String(value)
    }
  }
  return q
}

function restoreFiltersFromQuery() {
  const query = route.query
  if (query.sort && typeof query.sort === 'string') {
    searchStore.setSortBy(query.sort)
  }
  for (const [key, raw] of Object.entries(query)) {
    if (!key.startsWith('f.') || typeof raw !== 'string') continue
    const filterId = key.slice(2)
    const def = searchStore.activeFilterDefs.find(d => d.id === filterId)
    if (!def) continue
    if (def.type === 'toggle') {
      searchStore.setFilter(filterId, raw === '1')
    } else if (def.type === 'multi-select') {
      searchStore.setFilter(filterId, raw.split(',').filter(Boolean))
    } else {
      searchStore.setFilter(filterId, raw)
    }
  }
}

function syncFiltersToUrl() {
  if (suppressUrlSync) return
  const filterParams = filtersToQuery()

  const cleaned: Record<string, any> = {}
  for (const [k, v] of Object.entries(route.query)) {
    if (k !== 'sort' && !k.startsWith('f.')) cleaned[k] = v
  }
  router.replace({ query: { ...cleaned, ...filterParams } })
}

const { camera } = useMapCamera()

const authService = useAuthService()
const canAutoRefresh = computed(() => authService.hasPermission(PermissionId.SEARCH_AUTO_REFRESH))

const hasGeolocation = computed(() => geolocationService.hasLocation.value)

/** Build a bounding box around user location for "Near me" searches. */
function nearbyBounds(): MapBounds | null {
  const ll = geolocationService.lngLat.value
  if (!ll) return null
  // ~0.045 degrees ≈ 5 km at the equator; scale longitude by cos(lat)
  const latDelta = NEARBY_RADIUS_KM / 111
  const lngDelta = NEARBY_RADIUS_KM / (111 * Math.cos((ll.lat * Math.PI) / 180))
  return {
    north: ll.lat + latDelta,
    south: ll.lat - latDelta,
    east: ll.lng + lngDelta,
    west: ll.lng - lngDelta,
  }
}

// "Search this area" state lives in the store so the map overlay can read it

const searchType = computed(() => {
  if (route.query.categoryId) return 'category'
  if (route.query.brandKey) return 'brand'
  // if (route.query.overpassQuery) return 'overpass'
  return 'text'
})

// Brand results header (name + logo + total location count), set when a brand
// browse resolves.
const brandHeader = ref<BrandHeader | null>(null)
const brandTitle = computed(
  () => brandHeader.value?.name || (route.query.brandName as string) || '',
)

// Scroll pagination (category searches). `hasMoreResults` tracks whether the
// last page came back full (so another page may exist); `isLoadingMore` guards
// against firing overlapping page loads while one is in flight.
const hasMoreResults = ref(false)
const isLoadingMore = ref(false)

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

// Event listener reference for cleanup
let searchClickHandler: ((event: Event) => void) | null = null


// Search management

const debouncedMapRefresh = useDebounceFn(async (camera: MapCamera) => {
  searchStore.setMapRefreshing(true)
  try {
    // Map-move refresh: update markers for the new view, but don't re-frame the
    // camera (a brand refit here would fight the user's pan/zoom).
    await performSearch({ refit: false })
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
  // Ignore camera moves we triggered ourselves (brand result framing) — adopt
  // the settled view as the refresh baseline so a later user pan still works,
  // but never re-search from our own fitBounds (which would loop).
  if (Date.now() < programmaticMoveUntil) {
    lastRefreshBounds = mapService.getBounds()
    return
  }
  if (searchStore.searchContext === 'nearby') return
  if (!shouldMapRefresh(camera.value)) return

  if (canAutoRefresh.value) {
    // Premium: auto-refresh in the background
    debouncedMapRefresh(camera.value)
  } else {
    // Free tier: surface a manual "Search this area" prompt
    searchStore.pendingAreaSearch = true
  }
})

// React to "Search this area" button clicks from the map overlay
watch(() => searchStore.areaSearchRequestId, () => {
  // "Search this area" → search the current view; keep the camera where it is.
  performSearch({ refit: false })
})

// Handle click on search result from map markers
function handleSearchResultClick(place: Place, event: any) {
  if (place?.id) {
    // Seed the place view so it renders instantly; required for Pelias address
    // results, which have no backend record to re-fetch.
    setPartialPlace(place)
    const placeRoute = getPlaceRoute(place.id)
    router.push(placeRoute)
  }
}

// Frame the camera around the nearest `count` results (results come back
// distance-sorted from the viewport centre). Suppresses moveend auto-refresh
// while the programmatic move animates so it can't feed back into another search.
function frameNearestResults(places: Place[], count: number) {
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity
  for (const p of places.slice(0, count)) {
    const c = p.geometry?.value?.center
    if (!c) continue
    minLat = Math.min(minLat, c.lat); maxLat = Math.max(maxLat, c.lat)
    minLng = Math.min(minLng, c.lng); maxLng = Math.max(maxLng, c.lng)
  }
  if (Number.isFinite(minLat)) {
    programmaticMoveUntil = Date.now() + 2000
    mapService.fitBounds({ minLat, minLng, maxLat, maxLng }, { maxZoom: 15 })
  }
}

async function performSearch(opts: { refit?: boolean } = {}) {
  // `refit` frames the camera to a brand's nearest locations. Only true for a
  // fresh brand search — a map-move re-search must NOT re-fit, or the user could
  // never zoom out to see the rest.
  const refit = opts.refit ?? true
  searchStore.pendingAreaSearch = false
  searchStore.setSearchLoading(true)
  searchStore.setSearchError(null)

  // Set search metadata
  searchStore.setSearchType(
    searchType.value as 'text' | 'category' | 'brand' | 'overpass',
  )
  if (searchType.value === 'text') {
    searchStore.setSearchQuery(route.query.text as string)
  } else if (searchType.value === 'category') {
    searchStore.setSearchQuery(categoryTitle.value)
  } else if (searchType.value === 'brand') {
    searchStore.setSearchQuery(brandTitle.value)
  }

  const isNearby = searchStore.searchContext === 'nearby'
  const bounds = isNearby ? nearbyBounds() : mapService.getVisibleBounds()
  const center = isNearby && geolocationService.lngLat.value
    ? geolocationService.lngLat.value
    : mapService.getCenter()

  try {
    let places: Place[] = []
    const maxResults = 100

    // Track the max results in the search store
    searchStore.setLastMaxResults(maxResults)

    const { sort, filter, tags } = searchStore.serverFilterParams

    if (searchType.value === 'category') {
      // Record the category search into (encrypted) recents. Re-selecting it
      // re-runs the category (via the category:<id> path), not a text query.
      // Stash the icon so the empty-state palette can render it later.
      const catId = route.query.categoryId as string
      if (catId) {
        useRecentsStore().recordCategorySearch(catId, categoryTitle.value, {
          iconName: categoryData.value?.iconName ?? undefined,
          iconPack: categoryData.value?.iconPack,
          iconCategory:
            (route.query.categoryIconCategory as string) ??
            categoryData.value?.iconCategory ??
            undefined,
        })
      }

      const { results, fieldDefinitions, hasMore } = await searchService.searchByCategory(
        route.query.categoryId as string,
        {
          bounds: bounds || undefined,
          maxResults: CATEGORY_PAGE_SIZE,
          offset: 0,
          sort,
          filter,
          tags,
        },
      )
      places = results
      hasMoreResults.value = hasMore
      searchStore.setCategoryFields(fieldDefinitions)
    } else if (searchType.value === 'brand') {
      // Record the brand search into (encrypted) recents so it re-runs the
      // brand browse (via the brand:<key> path), not a text query.
      const brandKey = route.query.brandKey as string
      const brandName = (route.query.brandName as string) || brandKey
      if (brandKey) {
        useRecentsStore().recordBrandSearch(brandKey, brandName, brandName)
      }

      searchStore.setCategoryFields([])
      const { results, brand } = await searchService.searchByBrand({
        brandKey,
        brandName: route.query.brandName as string,
        // Viewport-first; the server widens to the nearest locations when sparse.
        // Capped low so a big chain frames to the nearest dozen, not the metro.
        bounds: bounds || undefined,
        lat: center.lat,
        lng: center.lng,
        maxResults: BRAND_MAX_RESULTS,
      })
      places = results
      brandHeader.value = brand
      // Backfill the recent entry's logo now that we have it.
      if (brandKey && brand?.logoUrl) {
        useRecentsStore().recordBrandSearch(brandKey, brandName, brandName, brand.logoUrl)
      }
    } else if (searchType.value === 'text') {
      // Record the committed query into (encrypted) recents. Every text search
      // — palette, direct URL, or a re-selected recent — lands here, so this is
      // the single choke-point. Dedupe just bumps recency on repeats.
      const textQuery = (route.query.q as string) ?? ''
      if (textQuery.trim()) useRecentsStore().recordSearch(textQuery)

      searchStore.setCategoryFields([])
      const searchResults = await searchService.search({
        query: route.query.q as string,
        lat: center.lat,
        lng: center.lng,
        autocomplete: false,
        maxResults,
      })
      places = (searchResults as SearchResult[])
        .filter(result => result.type === 'place')
        .map(result => result.metadata.place as unknown as Place)
    }

    // Update the search store with results - this will automatically update the map layer
    searchStore.setSearchResults(places)
    searchStore.setLastSearchBounds(bounds)
    lastRefreshBounds = bounds

    // Frame the camera around the nearest results on a fresh search when it helps
    // (every loaded place is still plotted as a marker regardless). A map-move
    // re-search must not re-fit, or the user could never zoom back out.
    //  - brand: always — a big chain stays usefully local (nearest dozen).
    //  - category: only when the viewport was sparse, i.e. the server widened a
    //    thin category (e.g. gas stations) to nearby matches that are off-screen.
    if (refit && places.length > 0) {
      if (searchType.value === 'brand') {
        frameNearestResults(places, BRAND_FIT_COUNT)
      } else if (searchType.value === 'category' && bounds) {
        const inView = places.filter(p => {
          const c = p.geometry?.value?.center
          return (
            !!c &&
            c.lat <= bounds.north &&
            c.lat >= bounds.south &&
            c.lng <= bounds.east &&
            c.lng >= bounds.west
          )
        }).length
        if (inView < CATEGORY_MIN_RESULTS) {
          frameNearestResults(places, CATEGORY_FIT_COUNT)
        }
      }
    }

    // On first load, restore filters from URL (after categoryFields are set)
    if (!filtersRestored) {
      filtersRestored = true
      suppressUrlSync = true
      restoreFiltersFromQuery()
      await nextTick()
      suppressUrlSync = false
    }
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

// Load the next page of category results and append them. Paginates against the
// bounds the search was run with (not the live viewport), so the nearest-first
// ordering stays consistent as the user scrolls.
async function loadMoreResults() {
  if (searchType.value !== 'category') return
  if (!hasMoreResults.value || isLoadingMore.value || searchStore.isLoading) return

  isLoadingMore.value = true
  try {
    const { sort, filter, tags } = searchStore.serverFilterParams
    const { results, hasMore } = await searchService.searchByCategory(
      route.query.categoryId as string,
      {
        bounds: searchStore.lastSearchBounds || undefined,
        maxResults: CATEGORY_PAGE_SIZE,
        offset: searchStore.searchResults.length,
        sort,
        filter,
        tags,
      },
    )
    searchStore.appendSearchResults(results)
    hasMoreResults.value = hasMore
  } catch (error) {
    console.error('Load more error:', error)
  } finally {
    isLoadingMore.value = false
  }
}

// Infinite scroll: pull the next page when the list nears the bottom.
function onResultsScroll(e: Event) {
  const el = e.target as HTMLElement
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) {
    loadMoreResults()
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
  (newQuery, oldQuery) => {
    const searchChanged =
      newQuery.categoryId !== oldQuery?.categoryId ||
      newQuery.brandKey !== oldQuery?.brandKey ||
      newQuery.q !== oldQuery?.q
    if (!searchChanged) return
    filtersRestored = false
    suppressUrlSync = true
    searchStore.resetFilters()
    suppressUrlSync = false
    performSearch()
  },
  { deep: true },
)

watch(
  () => searchStore.searchContext,
  () => performSearch(),
)

watch(
  [() => searchStore.filters, () => searchStore.sortBy],
  () => {
    syncFiltersToUrl()
  },
  { deep: true },
)

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

      <!-- Brand logo / icon -->
      <img
        v-else-if="searchType === 'brand' && brandHeader?.logoUrl"
        :src="brandHeader.logoUrl"
        :alt="brandTitle"
        class="w-10 h-10 rounded-md object-contain bg-background border p-1"
      />
      <ItemIcon
        v-else-if="searchType === 'brand'"
        icon="Store"
        icon-pack="lucide"
        variant="solid"
        shape="circle"
        size="md"
      />

      <!-- Title + meta -->
      <div class="flex flex-col min-w-0">
        <h2 class="text-lg font-bold text-foreground tracking-tight leading-tight">
          <span v-if="searchType === 'category'">{{ categoryTitle }}</span>
          <span v-else-if="searchType === 'brand'">{{ brandTitle }}</span>
          <span v-else-if="route.query.overpassQuery">Advanced Search</span>
          <span v-else>Search Results</span>
        </h2>
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <!-- Brands have a real, cheap total; category/text results paginate on
               scroll with no count (a true COUNT is expensive and not shown). -->
          <span v-if="searchType === 'brand' && brandHeader?.locationCount != null">
            {{ t('place.brand.locationsCount', { count: brandHeader.locationCount.toLocaleString() }) }}
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

    <div class="-mx-4 overflow-visible">
      <FilterChips
        class="w-full px-4"
        :filter-defs="searchStore.activeFilterDefs"
        :filter-values="searchStore.filters"
        :filter-options="searchStore.dynamicFilterOptions"
        :sort-options="searchStore.activeSortDefs"
        :sort-by="searchStore.sortBy"
        :search-context="searchStore.searchContext"
        :has-geolocation="hasGeolocation"
        @update:filter="searchStore.setFilter"
        @update:sort-by="searchStore.setSortBy"
        @update:search-context="searchStore.setSearchContext"
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
      @scroll.passive="onResultsScroll"
    >
      <div class="max-w-4xl mx-auto">
        <PlaceList
          :places="searchStore.filteredSearchResults"
          :loading="searchStore.isSearching && !searchStore.hasResults"
          @place-hover="searchStore.setHoveredPlace($event)"
          @place-leave="searchStore.setHoveredPlace(null)"
        />
        <!-- Scroll-pagination spinner -->
        <div v-if="isLoadingMore" class="flex justify-center py-4">
          <div class="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
        </div>
      </div>
    </div>
  </div>
</template>
