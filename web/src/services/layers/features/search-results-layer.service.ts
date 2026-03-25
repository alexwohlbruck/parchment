/**
 * Search Results Layer Service
 * 
 * Manages the interactive search results layer that displays search results on the map.
 * Handles GeoJSON data updates, Vue marker creation, and hover states.
 */

import type { Layer } from '@/types/map.types'
import type { Place } from '@/types/place.types'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { watch } from 'vue'
import { useSearchStore } from '@/stores/search.store'
import SearchResultMapIcon from '@/components/map/SearchResultMapIcon.vue'
import {
  SEARCH_RESULTS_LAYER_ID,
  SEARCH_RESULTS_SOURCE_ID,
  SEARCH_RESULTS_LABELS_LAYER_ID,
  SEARCH_RESULTS_LAYER_CONFIG,
  EMPTY_SEARCH_RESULTS_GEOJSON,
} from '@/constants/layer.constants'

export function useSearchResultsLayerService() {
  // State tracking
  let searchResultsVueMarkers = new Map<string, any>()
  let searchResultsReactivityInitialized = false
  let searchResultsSourceInitialized = false

  // ============================================================================
  // LAYER CREATION
  // ============================================================================

  function createSearchResultsLayer(): Layer {
    return {
      ...SEARCH_RESULTS_LAYER_CONFIG,
      id: SEARCH_RESULTS_LAYER_ID,
      userId: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  function initializeSearchResultsLayer(mapStrategy: MapStrategy) {
    // Skip if already initialized for this map instance
    if (searchResultsSourceInitialized) {
      return
    }

    // Get current search results to restore data after style change
    const searchStore = useSearchStore()
    const currentResults = searchStore.searchResults
    const currentGeoJSON =
      currentResults.length > 0
        ? createResultsGeoJSON(currentResults)
        : EMPTY_SEARCH_RESULTS_GEOJSON

    const mapInstance = mapStrategy.mapInstance

    // Add source directly on the map instance (synchronous, bypasses the async
    // style-load wrapper so source is guaranteed present before layer is added)
    if (!mapInstance.getSource(SEARCH_RESULTS_SOURCE_ID)) {
      mapInstance.addSource(SEARCH_RESULTS_SOURCE_ID, {
        type: 'geojson',
        data: currentGeoJSON,
      })
    } else {
      ;(mapInstance.getSource(SEARCH_RESULTS_SOURCE_ID) as any).setData(currentGeoJSON)
    }

    // Add the symbol layer via the strategy so engine-specific conversions
    // (e.g. Mapbox → MapLibre font translation) are applied automatically.
    // Source is already present so the strategy's source-existence check passes.
    if (!mapInstance.getLayer(SEARCH_RESULTS_LABELS_LAYER_ID)) {
      const layer = createSearchResultsLayer()
      layer.visible = currentResults.length > 0
      mapStrategy.addLayer(layer)
    }

    searchResultsSourceInitialized = true

    // Set up reactivity for search results (only once)
    initializeSearchResultsReactivity(mapStrategy)

    // If we have results, also recreate the Vue markers
    if (currentResults.length > 0) {
      updateSearchResultsVueMarkers(
        mapStrategy,
        currentResults,
        searchStore.hoveredPlaceId,
      )
    }
  }

  function initializeSearchResultsReactivity(mapStrategy: MapStrategy) {
    if (!mapStrategy || searchResultsReactivityInitialized) return

    // Watch for search results changes and update the layer
    const searchStore = useSearchStore()

    watch(
      () => searchStore.searchResults,
      newResults => {
        updateSearchResultsData(
          mapStrategy,
          newResults,
          searchStore.hoveredPlaceId,
        )
      },
      { deep: true },
    )

    watch(
      () => searchStore.hoveredPlaceId,
      newHoveredId => {
        updateSearchResultsHoverState(
          mapStrategy,
          searchStore.searchResults,
          newHoveredId,
        )
      },
    )

    searchResultsReactivityInitialized = true
  }

  // ============================================================================
  // DATA UPDATES
  // ============================================================================

  function updateSearchResultsData(
    mapStrategy: MapStrategy,
    places: Place[],
    hoveredPlaceId: string | null = null,
  ) {
    if (!mapStrategy) return

    // Update GeoJSON data
    const geoJSON = createResultsGeoJSON(places)
    const source = mapStrategy.mapInstance.getSource(SEARCH_RESULTS_SOURCE_ID)
    if (source) {
      source.setData(geoJSON)
    }

    // Show/hide the layer based on whether we have results
    const hasResults = places.length > 0
    if (mapStrategy.mapInstance.getLayer(SEARCH_RESULTS_LABELS_LAYER_ID)) {
      mapStrategy.toggleLayerVisibility(
        SEARCH_RESULTS_LABELS_LAYER_ID,
        hasResults,
      )
    }

    // Update Vue markers
    updateSearchResultsVueMarkers(mapStrategy, places, hoveredPlaceId)
  }

  function updateSearchResultsHoverState(
    mapStrategy: MapStrategy,
    places: Place[],
    hoveredPlaceId: string | null,
  ) {
    if (!mapStrategy) return
    updateSearchResultsVueMarkers(mapStrategy, places, hoveredPlaceId)
  }

  // ============================================================================
  // VUE MARKERS
  // ============================================================================

  function updateSearchResultsVueMarkers(
    mapStrategy: MapStrategy,
    places: Place[],
    hoveredPlaceId: string | null = null,
  ) {
    // Clear existing markers
    searchResultsVueMarkers.forEach((marker, placeId) => {
      const markerId = `search-result-${placeId}`
      mapStrategy.removeMarker(markerId)
    })
    searchResultsVueMarkers.clear()

    // Add new markers
    places.forEach(place => {
      if (!place.geometry?.value?.center) return

      const { lat, lng } = place.geometry.value.center
      const markerId = `search-result-${place.id}`

      const marker = mapStrategy.addVueMarker(
        markerId,
        { lat, lng },
        SearchResultMapIcon,
        {
          place,
          isHovered: hoveredPlaceId === place.id,
          onClick: (clickPlace: Place, event: MouseEvent) => {
            // Emit an event that can be handled by the search view
            document.dispatchEvent(
              new CustomEvent('search-result-click', {
                detail: { place: clickPlace, event },
              }),
            )
          },
          onMouseenter: (hoverPlace: Place, event: MouseEvent) => {
            const searchStore = useSearchStore()
            searchStore.setHoveredPlace(hoverPlace.id)
          },
          onMouseleave: (leavePlace: Place, event: MouseEvent) => {
            const searchStore = useSearchStore()
            if (searchStore.hoveredPlaceId === leavePlace.id) {
              searchStore.setHoveredPlace(null)
            }
          },
        },
      )

      searchResultsVueMarkers.set(place.id, marker)
    })
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  function removeSearchResultsLayer(mapStrategy: MapStrategy) {
    if (!mapStrategy) return

    // Clear Vue markers
    searchResultsVueMarkers.forEach((marker, placeId) => {
      const markerId = `search-result-${placeId}`
      mapStrategy.removeMarker(markerId)
    })
    searchResultsVueMarkers.clear()

    // Remove layer and source
    mapStrategy.removeLayer(SEARCH_RESULTS_LABELS_LAYER_ID)
    mapStrategy.removeSource(SEARCH_RESULTS_SOURCE_ID)

    // Reset flags so they can be reinitialized
    searchResultsReactivityInitialized = false
    searchResultsSourceInitialized = false
  }

  function resetLayerState() {
    // Reset all layer initialization flags when map changes
    searchResultsReactivityInitialized = false
    searchResultsSourceInitialized = false
    searchResultsVueMarkers.clear()
  }

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  function createResultsGeoJSON(places: Place[]) {
    const features = places
      .filter(place => place.geometry?.value?.center)
      .map(place => {
        const { lat, lng } = place.geometry.value.center
        const hasName =
          place.name.value && place.name.value !== place.placeType.value

        return {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [lng, lat],
          },
          properties: {
            id: place.id,
            // Omit `name` entirely when null so ['has', 'name'] filter works
            ...(hasName ? { name: place.name.value } : {}),
            placeType: place.placeType.value,
            category: place.icon?.category ?? 'default',
            hasLabel: hasName,
            sizerank: 10,
            class: 'place_like',
          },
        }
      })

    return {
      type: 'FeatureCollection' as const,
      features,
    }
  }

  return {
    createSearchResultsLayer,
    initializeSearchResultsLayer,
    updateSearchResultsData,
    updateSearchResultsHoverState,
    removeSearchResultsLayer,
    resetLayerState,
  }
}
