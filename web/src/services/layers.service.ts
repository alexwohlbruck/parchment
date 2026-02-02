import { api } from '@/lib/api'
import type { Layer, LayerGroup, LngLat } from '@/types/map.types'
import {
  LayerType,
  MapEngine,
  MapboxLayerType,
  MapColorTheme,
} from '@/types/map.types'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { toRaw, watch, Component } from 'vue'
import { cssHslToHex, adjustLightness } from '@/lib/utils'
import type { Place } from '@/types/place.types'
import SearchResultMapIcon from '@/components/map/SearchResultMapIcon.vue'
import { useSearchStore } from '@/stores/search.store'
import { useThemeStore } from '@/stores/theme.store'
import { useDirectionsStore } from '@/stores/directions.store'
import { useStorage } from '@vueuse/core'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { DEFAULT_SERVER_URL } from '@/lib/constants'
import { isTransitStopLayer } from '@/lib/transit.utils'
import { WaypointsLayer } from '@/components/map/layers/waypoints-layer'
import { FriendLocationsLayer } from '@/components/map/layers/friend-locations-layer'
import { TripInstructionsLayer } from '@/components/map/layers/trip-instructions-layer'
import {
  SEARCH_RESULTS_LAYER_ID,
  SEARCH_RESULTS_SOURCE_ID,
  SEARCH_RESULTS_LABELS_LAYER_ID,
  SEARCH_RESULTS_LAYER_CONFIG,
  EMPTY_SEARCH_RESULTS_GEOJSON,
  PLACE_POLYGON_LAYER_ID,
  PLACE_POLYGON_SOURCE_ID,
  PLACE_POLYGON_FILL_LAYER_ID,
  PLACE_POLYGON_STROKE_LAYER_ID,
  PLACE_POLYGON_FILL_LAYER_CONFIG,
  PLACE_POLYGON_STROKE_LAYER_CONFIG,
  EMPTY_PLACE_POLYGON_GEOJSON,
  getPlacePolygonFillColor,
  getPlacePolygonStrokeColor,
} from '@/constants/layer.constants'

export function useLayersService() {
  // Initialize stores inside the composable where Pinia is available
  const themeStore = useThemeStore()
  const directionsStore = useDirectionsStore()
  const router = useRouter()

  // Marker layer instances
  let waypointsLayer: WaypointsLayer | null = null
  let friendLocationsLayer: FriendLocationsLayer | null = null
  let tripInstructionsLayer: TripInstructionsLayer | null = null

  // Helper function to apply map color theme based on transit visibility and theme
  function applyTransitMapTheme(
    mapStrategy: MapStrategy,
    hasVisibleTransitLayers: boolean,
    hideTransitLabels: boolean = true,
  ) {
    // Only apply faded effect in light mode when transit layers are visible
    const shouldUseFaded = hasVisibleTransitLayers && !themeStore.isDark
    mapStrategy.setMapColorTheme(
      shouldUseFaded ? MapColorTheme.FADED : MapColorTheme.DEFAULT,
    )

    if (hideTransitLabels) {
      mapStrategy.setTransitLabels(!hasVisibleTransitLayers) // Hide default transit labels when our layers are active
    }
  }

  // Add click handlers for transit stops to open place detail view
  function addTransitStopClickHandlers(
    mapStrategy: MapStrategy,
    layerId: string,
  ) {
    if (!mapStrategy?.mapInstance) return

    const handleClick = (event: any) => {
      const feature = event.features?.[0]
      if (feature && feature.properties) {
        const onestopId =
          feature.properties.onestop_id || feature.properties.stop_id
        if (onestopId) {
          router.push({
            name: AppRoute.PLACE_PROVIDER,
            params: {
              provider: 'transitland',
              placeId: onestopId,
            },
          })
        }
      }
    }

    const handleMouseEnter = () => {
      mapStrategy.mapInstance.getCanvas().style.cursor = 'pointer'
    }

    const handleMouseLeave = () => {
      mapStrategy.mapInstance.getCanvas().style.cursor = ''
    }

    // Add all handlers
    mapStrategy.mapInstance.on('click', layerId, handleClick)
    mapStrategy.mapInstance.on('mouseenter', layerId, handleMouseEnter)
    mapStrategy.mapInstance.on('mouseleave', layerId, handleMouseLeave)
  }

  // Core CRUD operations (user layers only - no server-side defaults)
  async function getLayers() {
    const { data } = await api.get<Layer[]>('/library/layers')
    return data
  }

  async function createLayer(
    layer: Omit<Layer, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
  ) {
    const { data } = await api.post<Layer>('/library/layers', layer)
    return data
  }

  async function updateLayer(id: string, updates: Partial<Layer>) {
    const { data } = await api.put<Layer>(`/library/layers/${id}`, updates)
    return data
  }

  async function deleteLayer(id: string) {
    await api.delete(`/library/layers/${id}`)
  }

  async function getLayerGroups() {
    const { data } = await api.get<LayerGroup[]>('/library/layers/groups')
    return data
  }

  async function createLayerGroup(
    group: Omit<LayerGroup, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
  ) {
    const { data } = await api.post<LayerGroup>('/library/layers/groups', group)
    return data
  }

  async function updateLayerGroup(id: string, updates: Partial<LayerGroup>) {
    const { data } = await api.put<LayerGroup>(
      `/library/layers/groups/${id}`,
      updates,
    )
    return data
  }

  async function deleteLayerGroup(id: string) {
    await api.delete(`/library/layers/groups/${id}`)
  }

  async function reorderLayers(
    items: { id: string; order: number; groupId?: string | null }[],
  ): Promise<boolean> {
    try {
      await api.put('/library/layers/reorder', { items })
      return true
    } catch (error) {
      console.error('Failed to reorder layers:', error)
      return false
    }
  }

  async function moveLayer(
    layerId: string,
    targetGroupId: string | null,
    targetOrder: number,
  ) {
    const { data } = await api.put(`/library/layers/${layerId}/move`, {
      targetGroupId,
      targetOrder,
    })
    return data
  }

  async function moveLayerGroup(groupId: string, targetOrder: number) {
    const { data } = await api.put(`/library/layers/groups/${groupId}/move`, {
      targetOrder,
    })
    return data
  }

  // Map integration functions
  function initializeLayers(layers: Layer[], mapStrategy?: MapStrategy) {
    if (!mapStrategy) return

    layers.forEach(layer => {
      // Convert reactive proxy to plain object to avoid proxy issues
      const plainLayer = toRaw(layer)

      // Special handling for search results layer (both old and core layer IDs)
      if (
        plainLayer.id === SEARCH_RESULTS_LAYER_ID ||
        plainLayer.configuration?.id === SEARCH_RESULTS_LABELS_LAYER_ID
      ) {
        initializeSearchResultsLayer(mapStrategy)
      }

      // Add transit stop click handlers for transit stop layers
      if (isTransitStopLayer(plainLayer.configuration?.id)) {
        addTransitStopClickHandlers(mapStrategy, plainLayer.configuration.id)
      }

      mapStrategy.addLayer(plainLayer)
    })
  }

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

    // Create the search results source with current data
    try {
      mapStrategy.addSource(SEARCH_RESULTS_SOURCE_ID, {
        type: 'geojson',
        data: currentGeoJSON,
      })
      searchResultsSourceInitialized = true
    } catch (error) {
      // Source might already exist, update it instead
      const source = mapStrategy.mapInstance.getSource(SEARCH_RESULTS_SOURCE_ID)
      if (source) {
        source.setData(currentGeoJSON)
        searchResultsSourceInitialized = true
      } else {
        console.warn('Failed to add search results source:', error)
        return
      }
    }

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

  function toggleLayerVisibility(
    layerId: Layer['configuration']['id'],
    visible: boolean,
    mapStrategy?: MapStrategy,
  ) {
    // Update map visualization if strategy is provided
    if (mapStrategy) {
      mapStrategy.toggleLayerVisibility(layerId, visible)
    }
  }

  // Helper function to check if any transit layers are visible
  function checkTransitLayersVisibility(
    layers: Layer[],
    layerConfigId?: string,
    newState?: boolean,
  ): boolean {
    return layers.some(l => {
      if (l.type !== LayerType.TRANSIT) return false

      // If this is the layer being updated, use the new state
      if (layerConfigId && l.configuration.id === layerConfigId) {
        return newState ?? false
      }

      // Otherwise use current visibility
      return l.visible
    })
  }

  // SERVER-FIRST visibility updates (no optimistic local store changes)
  async function setLayerVisibility(
    layerConfigId: Layer['configuration']['id'],
    layers: Layer[],
    layersStore: any,
    mapStrategy?: MapStrategy,
    state?: boolean,
  ) {
    const layer = layers.find(l => l.configuration.id === layerConfigId)
    if (!layer) return

    const newState = state ?? !layer.visible

    // For client-side layers, only update visibility in memory (no server update)
    if (layer.id.startsWith('client-')) {
      layersStore.updateLayerVisibility(layer.id, newState)
    } else {
      // For user layers, update server via store updater (which persists and updates store)
      await layersStore.updateLayer(layer.id, { visible: newState })
    }

    // Then update map visualization
    toggleLayerVisibility(layerConfigId, newState, mapStrategy)

    // Handle special layer types
    if (layer.type === LayerType.TRANSIT && mapStrategy) {
      // For Transitland layers, also toggle the case layer
      if (layer.configuration.id === 'transitland') {
        const caseLayer = layers.find(
          l => l.configuration.id === 'transitland-case',
        )
        if (caseLayer) {
          if (caseLayer.id.startsWith('client-')) {
            layersStore.updateLayerVisibility(caseLayer.id, newState)
          } else {
            await layersStore.updateLayer(caseLayer.id, { visible: newState })
          }
          toggleLayerVisibility('transitland-case', newState, mapStrategy)
        }
      }

      // Apply map color theme and transit labels based on transit layer visibility
      const hasVisibleTransitLayers = checkTransitLayersVisibility(
        layers,
        layerConfigId,
        newState,
      )
      applyTransitMapTheme(mapStrategy, hasVisibleTransitLayers)
    }
  }

  // Show-in-selector toggles (do not affect map visibility)
  async function setLayerShownInSelector(
    layerConfigId: Layer['configuration']['id'],
    layers: Layer[],
    layersStore: any,
    state?: boolean,
  ) {
    const layer = layers.find(l => l.configuration.id === layerConfigId)
    if (!layer) return

    const newState = state ?? !layer.showInLayerSelector
    await layersStore.updateLayer(layer.id, { showInLayerSelector: newState })
  }

  async function setGroupShownInSelector(
    group: LayerGroup,
    layersStore: any,
    state?: boolean,
  ) {
    const newState = state ?? !group.showInLayerSelector
    await layersStore.updateLayerGroup(group.id, {
      showInLayerSelector: newState,
    })
  }

  async function toggleLayerGroupVisibility(
    group: LayerGroup,
    visible: boolean,
    layersStore: any,
    layers: Layer[],
    mapStrategy?: MapStrategy,
  ) {
    // For client-side groups, only update visibility in memory
    if (group.id.startsWith('client-')) {
      layersStore.toggleLayerGroupVisibility(group.id, visible)
    } else {
      // Update the group's own visible state on the server
      await layersStore.updateLayerGroup(group.id, { visible })
    }

    // Find all layers in this group from the provided layers array
    const groupLayers = layers.filter(l => l.groupId === group.id)

    // Check if this group contains transit layers
    const hasTransitLayers = groupLayers.some(l => l.type === LayerType.TRANSIT)

    // Update each layer's visibility
    for (const layer of groupLayers) {
      try {
        if (layer.id.startsWith('client-')) {
          // For client-side layers, only update in memory
          layersStore.updateLayerVisibility(layer.id, visible)
        } else {
          // For user layers, update on server
          await layersStore.updateLayer(layer.id, { visible })
        }
        toggleLayerVisibility(layer.configuration.id, visible, mapStrategy)
      } catch (error) {
        console.error(`Failed to set visibility for layer ${layer.id}`, error)
      }
    }

    // Apply map color theme if this group contains transit layers
    if (hasTransitLayers && mapStrategy) {
      // Check if any transit layers will be visible after this group toggle
      const hasVisibleTransitLayers = layers.some(l => {
        if (l.type !== LayerType.TRANSIT) return false

        // If this layer is in the group being toggled, use the new visibility state
        if (l.groupId === group.id) {
          return visible
        }

        // Otherwise use current visibility
        return l.visible
      })

      applyTransitMapTheme(mapStrategy, hasVisibleTransitLayers)
    }
  }

  async function toggleStreetViewLayers(
    layers: Layer[],
    layersStore: any,
    mapStrategy?: MapStrategy,
    visible?: boolean,
  ) {
    const newState = visible ?? false

    const streetViewLayers = layers.filter(
      layer => layer.type === LayerType.STREET_VIEW,
    )

    for (const layer of streetViewLayers) {
      try {
        if (layer.id.startsWith('client-')) {
          // For client-side layers, only update in memory
          layersStore.updateLayerVisibility(layer.id, newState)
        } else {
          // For user layers, update on server
          await layersStore.updateLayer(layer.id, { visible: newState })
        }
        toggleLayerVisibility(layer.configuration.id, newState, mapStrategy)
      } catch (error) {
        console.error(
          `Failed to set street view layer ${layer.id} visibility:`,
          error,
        )
      }
    }
  }

  async function toggleTransitLayers(
    layers: Layer[],
    layersStore: any,
    mapStrategy?: MapStrategy,
    visible?: boolean,
  ) {
    const newState = visible ?? false

    const transitLayers = layers.filter(
      layer => layer.type === LayerType.TRANSIT,
    )

    for (const layer of transitLayers) {
      try {
        if (layer.id.startsWith('client-')) {
          // For client-side layers, only update in memory
          layersStore.updateLayerVisibility(layer.id, newState)
        } else {
          // For user layers, update on server
          await layersStore.updateLayer(layer.id, { visible: newState })
        }
        toggleLayerVisibility(layer.configuration.id, newState, mapStrategy)
      } catch (error) {
        console.error(
          `Failed to set transit layer ${layer.id} visibility:`,
          error,
        )
      }
    }

    // Set map color theme and transit labels based on transit layer visibility
    if (mapStrategy) {
      applyTransitMapTheme(mapStrategy, newState)
    }
  }

  function addLayerToMap(layer: Layer, mapStrategy?: MapStrategy) {
    if (!mapStrategy) return
    const plainLayer = toRaw(layer)

    // Add transit stop click handlers for dynamically added transit stop layers
    if (isTransitStopLayer(plainLayer.configuration?.id)) {
      addTransitStopClickHandlers(mapStrategy, plainLayer.configuration.id)
    }

    mapStrategy.addLayer(plainLayer)
  }

  function removeLayerFromMap(
    layerId: Layer['configuration']['id'],
    mapStrategy?: MapStrategy,
  ) {
    if (!mapStrategy) return
    mapStrategy.removeLayer(layerId)
  }

  // Interactive Search Results Layer Management
  interface SearchResultsLayerOptions {
    layerId: string
    sourceId: string
    places: Place[]
    hoveredPlaceId?: string | null
    onPlaceClick?: (place: Place, event: any) => void
    onPlaceHover?: (place: Place, event: any) => void
    onPlaceLeave?: (place: Place, event: any) => void
  }

  // TODO: Unused code?
  function createInteractiveResultsLayer(
    mapStrategy: MapStrategy,
    options: SearchResultsLayerOptions,
  ) {
    const {
      layerId,
      sourceId,
      places,
      hoveredPlaceId = null,
      onPlaceClick,
      onPlaceHover,
      onPlaceLeave,
    } = options

    const vueMarkers = new Map<string, any>()
    const geoJSON = createResultsGeoJSON(places)

    // Create or reset data source
    try {
      mapStrategy.addSource(sourceId, {
        type: 'geojson',
        data: geoJSON,
      })
    } catch (error) {
      const source = mapStrategy.mapInstance.getSource(sourceId)
      if (source) {
        source.setData(geoJSON)
      }
    }

    // Create text label layer
    const labelLayerId = `${layerId}-labels`
    const labelLayer: Layer = {
      id: labelLayerId,
      name: 'Search Results Labels',
      type: LayerType.CUSTOM,
      engine: [MapEngine.MAPBOX],
      showInLayerSelector: false,
      visible: true,
      icon: null,
      order: 1000,
      groupId: null,
      configuration: {
        id: labelLayerId,
        type: MapboxLayerType.SYMBOL,
        source: sourceId,
        minzoom: 6,
        filter: ['has', 'name'],
        layout: {
          'symbol-z-elevate': true,
          'text-size': 13,
          'text-field': ['get', 'name'],
          'text-font': [
            ['concat', ['config', 'font'], ' Medium'],
            'DIN Pro',
            'Inter',
            'Arial Unicode MS Bold',
          ],
          'text-padding': ['interpolate', ['linear'], ['zoom'], 16, 6, 17, 4],
          'text-offset': [0, 1],
          'text-anchor': 'top',
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'symbol-sort-key': 1000,
        },
        paint: {
          'text-halo-width': 2,
          'text-halo-blur': 0,
          'text-halo-color': [
            'interpolate',
            ['linear'],
            ['measure-light', 'brightness'],
            0.25,
            'hsl(0, 0%, 5%)',
            0.3,
            'hsl(0, 0%, 100%)',
          ],
          'text-color': [
            'interpolate',
            ['linear'],
            ['measure-light', 'brightness'],
            0.25,
            'hsl(0, 0%, 95%)',
            0.3,
            'hsl(0, 0%, 15%)',
          ],
        },
      },
      userId: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    mapStrategy.addLayer(labelLayer)

    // Add interactive handlers for text labels
    if (onPlaceClick || onPlaceHover || onPlaceLeave) {
      addInteractiveLayerHandlers(mapStrategy, labelLayerId, places, {
        onPlaceClick,
        onPlaceHover,
        onPlaceLeave,
      })
    }

    const addVueMarkers = (placesToAdd: Place[], hoveredId?: string | null) => {
      placesToAdd.forEach(place => {
        if (!place.geometry?.value?.center) return

        const { lat, lng } = place.geometry.value.center
        const markerId = `search-result-${place.id}`

        removeVueMarker(place.id)

        const marker = mapStrategy.addVueMarker(
          markerId,
          { lat, lng },
          SearchResultMapIcon,
          {
            place,
            isHovered: hoveredId === place.id,
            onClick: (clickPlace: Place, event: MouseEvent) =>
              onPlaceClick?.(clickPlace, event),
            onMouseenter: (hoverPlace: Place, event: MouseEvent) =>
              onPlaceHover?.(hoverPlace, event),
            onMouseleave: (leavePlace: Place, event: MouseEvent) =>
              onPlaceLeave?.(leavePlace, event),
          },
        )

        vueMarkers.set(place.id, marker)
      })
    }

    const removeVueMarker = (placeId: string) => {
      const markerId = `search-result-${placeId}`
      mapStrategy.removeMarker(markerId)
      vueMarkers.delete(placeId)
    }

    const removeAllVueMarkers = () => {
      vueMarkers.forEach((marker, placeId) => {
        const markerId = `search-result-${placeId}`
        mapStrategy.removeMarker(markerId)
      })
      vueMarkers.clear()
    }

    addVueMarkers(places, hoveredPlaceId)

    return {
      layerId,
      sourceId,
      labelLayerId,
      updateData: (newPlaces: Place[], newHoveredId?: string | null) => {
        const newGeoJSON = createResultsGeoJSON(newPlaces)
        const source = mapStrategy.mapInstance.getSource(sourceId)
        if (source) {
          source.setData(newGeoJSON)
        }

        removeAllVueMarkers()
        if (newPlaces.length > 0) {
          addVueMarkers(newPlaces, newHoveredId)
        }
      },
      updateHoverState: (newHoveredId: string | null) => {
        removeAllVueMarkers()
        if (places.length > 0) {
          addVueMarkers(places, newHoveredId)
        }
      },
      remove: () => {
        removeAllVueMarkers()
        mapStrategy.removeLayer(labelLayerId)
        mapStrategy.removeSource(sourceId)
      },
    }
  }

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
            name: hasName ? place.name.value : null,
            placeType: place.placeType.value,
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

  function addInteractiveLayerHandlers(
    mapStrategy: MapStrategy,
    layerId: string,
    places: Place[],
    handlers: {
      onPlaceClick?: (place: Place, event: any) => void
      onPlaceHover?: (place: Place, event: any) => void
      onPlaceLeave?: (place: Place, event: any) => void
    },
  ) {
    const { onPlaceClick, onPlaceHover, onPlaceLeave } = handlers

    if (onPlaceClick) {
      mapStrategy.mapInstance.on('click', layerId, (event: any) => {
        const feature = event.features?.[0]
        if (feature) {
          const place = places.find(p => p.id === feature.properties.id)
          if (place) {
            onPlaceClick(place, event)
          }
        }
      })
    }

    if (onPlaceHover) {
      mapStrategy.mapInstance.on('mouseenter', layerId, (event: any) => {
        const feature = event.features?.[0]
        if (feature) {
          const place = places.find(p => p.id === feature.properties.id)
          if (place) {
            onPlaceHover(place, event)
          }
        }
      })
    }

    if (onPlaceLeave) {
      mapStrategy.mapInstance.on('mouseleave', layerId, (event: any) => {
        const feature = event.features?.[0]
        if (feature) {
          const place = places.find(p => p.id === feature.properties.id)
          if (place) {
            onPlaceLeave(place, event)
          }
        }
      })
    }
  }

  // Search results layer management
  let searchResultsVueMarkers = new Map<string, any>()
  let searchResultsReactivityInitialized = false
  let searchResultsSourceInitialized = false

  function createSearchResultsLayer(): Layer {
    return {
      ...SEARCH_RESULTS_LAYER_CONFIG,
      id: SEARCH_RESULTS_LAYER_ID,
      userId: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
    toggleLayerVisibility(
      SEARCH_RESULTS_LABELS_LAYER_ID,
      hasResults,
      mapStrategy,
    )

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
            const searchStore = useSearchStore()
            // Store the clicked place for the view to handle
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

  // Theme-reactive layer color updates
  function updatePlacePolygonColors(mapStrategy: MapStrategy) {
    if (!mapStrategy) return

    try {
      // Update fill layer color
      mapStrategy.mapInstance.setPaintProperty(
        PLACE_POLYGON_FILL_LAYER_ID,
        'fill-color',
        getPlacePolygonFillColor(),
      )

      // Update stroke layer color
      mapStrategy.mapInstance.setPaintProperty(
        PLACE_POLYGON_STROKE_LAYER_ID,
        'line-color',
        getPlacePolygonStrokeColor(),
      )
    } catch (error) {
      console.error('Failed to update place polygon colors:', error)
    }
  }

  // Place geometry layer management (handles polygons, multipolygons, and linestrings)
  function createGeometryGeoJSON(place: Place) {
    const geometry = place.geometry?.value
    if (!geometry) {
      return EMPTY_PLACE_POLYGON_GEOJSON
    }

    let geoJSONGeometry: any = null

    switch (geometry.type) {
      case 'linestring':
        if (geometry.nodes && geometry.nodes.length > 0) {
          const coordinates = geometry.nodes.map(node => [node.lng, node.lat])
          geoJSONGeometry = {
            type: 'LineString',
            coordinates,
          }
        }
        break

      case 'polygon':
        if (geometry.nodes && geometry.nodes.length > 0) {
          const coordinates = geometry.nodes.map(node => [node.lng, node.lat])

          // Ensure the polygon is closed by adding the first point at the end if needed
          if (coordinates.length > 0) {
            const firstPoint = coordinates[0]
            const lastPoint = coordinates[coordinates.length - 1]
            if (
              firstPoint[0] !== lastPoint[0] ||
              firstPoint[1] !== lastPoint[1]
            ) {
              coordinates.push(firstPoint)
            }
          }

          geoJSONGeometry = {
            type: 'Polygon',
            coordinates: [coordinates], // Single ring for now (exterior only)
          }
        }
        break

      case 'multipolygon':
        if (geometry.polygons && geometry.polygons.length > 0) {
          // Handle multiple polygons properly
          const allPolygons = geometry.polygons.map(polygonNodes => {
            const coordinates = polygonNodes.map(node => [node.lng, node.lat])

            // Ensure each polygon is closed
            if (coordinates.length > 0) {
              const firstPoint = coordinates[0]
              const lastPoint = coordinates[coordinates.length - 1]
              if (
                firstPoint[0] !== lastPoint[0] ||
                firstPoint[1] !== lastPoint[1]
              ) {
                coordinates.push(firstPoint)
              }
            }

            return [coordinates] // Each polygon has one ring (exterior only for now)
          })

          geoJSONGeometry = {
            type: 'MultiPolygon',
            coordinates: allPolygons,
          }
        }
        break

      default:
        // Point or unsupported geometry - return empty
        return EMPTY_PLACE_POLYGON_GEOJSON
    }

    if (!geoJSONGeometry) {
      return EMPTY_PLACE_POLYGON_GEOJSON
    }

    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {
            id: place.id,
            name: place.name.value || '',
            placeType: place.placeType.value,
            geometryType: geometry.type,
          },
          geometry: geoJSONGeometry,
        },
      ],
    }
  }

  function initializePlacePolygonLayers(mapStrategy: MapStrategy) {
    if (!mapStrategy) return

    // Create polygon source with empty data initially
    try {
      mapStrategy.addSource(PLACE_POLYGON_SOURCE_ID, {
        type: 'geojson',
        data: EMPTY_PLACE_POLYGON_GEOJSON,
      })
    } catch (error) {
      // Source might already exist, update it instead
      const source = mapStrategy.mapInstance.getSource(PLACE_POLYGON_SOURCE_ID)
      if (source) {
        source.setData(EMPTY_PLACE_POLYGON_GEOJSON)
      }
    }

    // Add fill layer (background)
    const fillLayer: Layer = {
      ...PLACE_POLYGON_FILL_LAYER_CONFIG,
      id: PLACE_POLYGON_FILL_LAYER_ID,
      userId: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    mapStrategy.addLayer(fillLayer)

    // Add stroke layer (border)
    const strokeLayer: Layer = {
      ...PLACE_POLYGON_STROKE_LAYER_CONFIG,
      id: PLACE_POLYGON_STROKE_LAYER_ID,
      userId: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    mapStrategy.addLayer(strokeLayer)
  }

  function updatePlacePolygon(mapStrategy: MapStrategy, place: Place | null) {
    if (!mapStrategy) return

    const geoJSON = place
      ? createGeometryGeoJSON(place)
      : EMPTY_PLACE_POLYGON_GEOJSON
    const source = mapStrategy.mapInstance.getSource(PLACE_POLYGON_SOURCE_ID)

    if (source) {
      source.setData(geoJSON)
    }

    // Show/hide layers based on whether we have geometric data (polygon, multipolygon, or linestring)
    const hasGeometryData = Boolean(
      place &&
      place.geometry?.value &&
      // Check for polygon/multipolygon with nodes
      ((place.geometry.value.type === 'polygon' &&
        place.geometry.value.nodes &&
        place.geometry.value.nodes.length > 0) ||
        (place.geometry.value.type === 'multipolygon' &&
          place.geometry.value.polygons &&
          place.geometry.value.polygons.length > 0) ||
        // Check for linestring with nodes
        (place.geometry.value.type === 'linestring' &&
          place.geometry.value.nodes &&
          place.geometry.value.nodes.length > 0)),
    )

    toggleLayerVisibility(
      PLACE_POLYGON_FILL_LAYER_ID,
      hasGeometryData,
      mapStrategy,
    )
    toggleLayerVisibility(
      PLACE_POLYGON_STROKE_LAYER_ID,
      hasGeometryData,
      mapStrategy,
    )
  }

  function removePlacePolygonLayers(mapStrategy: MapStrategy) {
    if (!mapStrategy) return

    // Remove layers and source
    mapStrategy.removeLayer(PLACE_POLYGON_STROKE_LAYER_ID)
    mapStrategy.removeLayer(PLACE_POLYGON_FILL_LAYER_ID)
    mapStrategy.removeSource(PLACE_POLYGON_SOURCE_ID)
  }

  // ============================================================================
  // MARKER LAYERS (Waypoints, Friends, Trip Instructions)
  // ============================================================================

  /**
   * Initialize marker layers with map strategy
   * Call this after map is loaded
   */
  function initializeMarkerLayers(mapStrategy: MapStrategy) {
    // Create marker layer instances
    waypointsLayer = new WaypointsLayer()
    friendLocationsLayer = new FriendLocationsLayer()
    tripInstructionsLayer = new TripInstructionsLayer()

    // Initialize with map API
    const markerAPI = {
      addVueMarker: (
        id: string,
        lngLat: LngLat,
        component: Component,
        props: Record<string, any>,
        zIndex?: number,
      ) => mapStrategy?.addVueMarker(id, lngLat, component, props, zIndex),
      removeMarker: (id: string) => mapStrategy?.removeMarker(id),
      hasMarker: (id: string) => mapStrategy?.hasMarker(id) ?? false,
    }

    waypointsLayer.initialize(markerAPI)
    friendLocationsLayer.initialize(markerAPI)
    tripInstructionsLayer.initialize(markerAPI)

    // Set up watchers for reactive updates
    setupMarkerLayerWatchers()
  }

  /**
   * Set up watchers to sync marker layers with store state
   */
  function setupMarkerLayerWatchers() {
    // Watch for trip changes
    watch(
      () => directionsStore.trips,
      trips => {
        if (trips) {
          // Show the first trip by default (recommended or first in list)
          const firstTrip =
            trips.trips.find(trip => trip.isRecommended) || trips.trips[0]

          // Update instruction markers if showing single trip
          if (firstTrip) {
            tripInstructionsLayer?.setTrip(firstTrip)
          } else {
            tripInstructionsLayer?.setTrip(null)
          }
        } else {
          // Clear instruction markers when trips are cleared
          tripInstructionsLayer?.setTrip(null)
        }
      },
    )

    // Watch for selected trip changes
    watch(
      () => directionsStore.selectedTripId,
      selectedTripId => {
        const trips = directionsStore.trips
        if (!trips || !selectedTripId) {
          // Clear instruction markers when no trip is selected
          tripInstructionsLayer?.setTrip(null)
          return
        }

        // Update instruction markers for selected trip
        const trip = trips.trips.find(t => t.id === selectedTripId)
        tripInstructionsLayer?.setTrip(trip || null)
      },
    )
  }

  /**
   * Destroy marker layers and clean up
   */
  function destroyMarkerLayers() {
    waypointsLayer?.destroy()
    friendLocationsLayer?.destroy()
    tripInstructionsLayer?.destroy()

    waypointsLayer = null
    friendLocationsLayer = null
    tripInstructionsLayer = null
  }

  /**
   * Highlight a specific instruction point (for UI interactions)
   */
  function highlightInstructionPoint(
    segmentIndex: number,
    instructionIndex: number,
  ) {
    tripInstructionsLayer?.highlightInstruction(segmentIndex, instructionIndex)
  }

  /**
   * Clear highlighted instruction point
   */
  function clearHighlightedInstructionPoint() {
    tripInstructionsLayer?.clearHighlight()
  }

  return {
    getLayers,
    createLayer,
    updateLayer,
    deleteLayer,
    getLayerGroups,
    createLayerGroup,
    updateLayerGroup,
    deleteLayerGroup,
    reorderLayers,
    moveLayer,
    moveLayerGroup,

    initializeLayers,
    setLayerVisibility,
    toggleLayerVisibility,
    toggleLayerGroupVisibility,
    toggleStreetViewLayers,
    toggleTransitLayers,
    addLayerToMap,
    removeLayerFromMap,
    setLayerShownInSelector,
    setGroupShownInSelector,

    // Search results layer management
    createSearchResultsLayer,
    updateSearchResultsData,
    updateSearchResultsHoverState,
    removeSearchResultsLayer,
    resetLayerState,

    // Place polygon layer management
    initializePlacePolygonLayers,
    updatePlacePolygon,
    updatePlacePolygonColors,
    removePlacePolygonLayers,

    // Marker layers management
    initializeMarkerLayers,
    destroyMarkerLayers,
    highlightInstructionPoint,
    clearHighlightedInstructionPoint,
  }
}
