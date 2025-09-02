import { api } from '@/lib/api'
import type { Layer, LayerGroup } from '@/types/map.types'
import { LayerType, MapEngine, MapboxLayerType } from '@/types/map.types'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { toRaw, watch } from 'vue'
import { cssHslToHex, adjustLightness } from '@/lib/utils'
import type { Place } from '@/types/place.types'
import SearchResultMapIcon from '@/components/map/SearchResultMapIcon.vue'
import { useSearchStore } from '@/stores/search.store'
import {
  SEARCH_RESULTS_LAYER_ID,
  SEARCH_RESULTS_SOURCE_ID,
  SEARCH_RESULTS_LABELS_LAYER_ID,
  SEARCH_RESULTS_LAYER_CONFIG,
  EMPTY_SEARCH_RESULTS_GEOJSON,
} from '@/constants/layer.constants'

export function useLayersService() {
  // Core CRUD operations
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

  async function restoreDefaultLayers(): Promise<{
    success: boolean
    restored: number
  }> {
    const { data } = await api.post('/library/layers/restore-defaults', {})
    return data
  }

  // Map integration functions
  function initializeLayers(layers: Layer[], mapStrategy?: MapStrategy) {
    if (!mapStrategy) return

    layers.forEach(layer => {
      // Convert reactive proxy to plain object to avoid proxy issues
      const plainLayer = toRaw(layer)
      
      // Special handling for search results layer
      if (plainLayer.id === SEARCH_RESULTS_LAYER_ID) {
        initializeSearchResultsLayer(mapStrategy)
      }
      
      mapStrategy.addLayer(plainLayer)
    })
  }

  function initializeSearchResultsLayer(mapStrategy: MapStrategy) {
    // Get current search results to restore data after style change
    const searchStore = useSearchStore()
    const currentResults = searchStore.searchResults
    const currentGeoJSON = currentResults.length > 0 
      ? createResultsGeoJSON(currentResults) 
      : EMPTY_SEARCH_RESULTS_GEOJSON
    
    // Create the search results source with current data
    try {
      mapStrategy.addSource(SEARCH_RESULTS_SOURCE_ID, {
        type: 'geojson',
        data: currentGeoJSON,
      })
    } catch (error) {
      // Source might already exist, update it instead
      const source = mapStrategy.mapInstance.getSource(SEARCH_RESULTS_SOURCE_ID)
      if (source) {
        source.setData(currentGeoJSON)
      }
    }
    
    // Set up reactivity for search results (only once)
    initializeSearchResultsReactivity(mapStrategy)
    
    // If we have results, also recreate the Vue markers
    if (currentResults.length > 0) {
      updateSearchResultsVueMarkers(mapStrategy, currentResults, searchStore.hoveredPlaceId)
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

    // First update server via store updater (which persists and updates store)
    await layersStore.updateLayer(layer.id, { visible: newState })

    // Then update map visualization
    toggleLayerVisibility(layerConfigId, newState, mapStrategy)
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
    // Update the group's own visible state on the server
    await layersStore.updateLayerGroup(group.id, { visible })

    // Find all layers in this group from the provided layers array (DB data)
    const groupLayers = layers.filter(l => l.groupId === group.id)

    // Update each layer on the server first, then reflect on the map
    for (const layer of groupLayers) {
      try {
        await layersStore.updateLayer(layer.id, { visible })
        toggleLayerVisibility(layer.configuration.id, visible, mapStrategy)
      } catch (error) {
        console.error(`Failed to set visibility for layer ${layer.id}`, error)
      }
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
        await layersStore.updateLayer(layer.id, { visible: newState })
        toggleLayerVisibility(layer.configuration.id, newState, mapStrategy)
      } catch (error) {
        console.error(
          `Failed to set street view layer ${layer.id} visibility:`,
          error,
        )
      }
    }
  }

  function addLayerToMap(layer: Layer, mapStrategy?: MapStrategy) {
    if (!mapStrategy) return
    const plainLayer = toRaw(layer)
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
      (newResults) => {
        updateSearchResultsData(mapStrategy, newResults, searchStore.hoveredPlaceId)
      },
      { deep: true }
    )

    watch(
      () => searchStore.hoveredPlaceId,
      (newHoveredId) => {
        updateSearchResultsHoverState(mapStrategy, searchStore.searchResults, newHoveredId)
      }
    )

    searchResultsReactivityInitialized = true
  }

  function updateSearchResultsData(
    mapStrategy: MapStrategy,
    places: Place[],
    hoveredPlaceId: string | null = null
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
    toggleLayerVisibility(SEARCH_RESULTS_LABELS_LAYER_ID, hasResults, mapStrategy)

    // Update Vue markers
    updateSearchResultsVueMarkers(mapStrategy, places, hoveredPlaceId)
  }

  function updateSearchResultsHoverState(
    mapStrategy: MapStrategy,
    places: Place[],
    hoveredPlaceId: string | null
  ) {
    if (!mapStrategy) return
    updateSearchResultsVueMarkers(mapStrategy, places, hoveredPlaceId)
  }

  function updateSearchResultsVueMarkers(
    mapStrategy: MapStrategy,
    places: Place[],
    hoveredPlaceId: string | null = null
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
            document.dispatchEvent(new CustomEvent('search-result-click', { 
              detail: { place: clickPlace, event } 
            }))
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
    
    // Reset reactivity flag so it can be reinitialized
    searchResultsReactivityInitialized = false
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
    restoreDefaultLayers,

    initializeLayers,
    setLayerVisibility,
    toggleLayerVisibility,
    toggleLayerGroupVisibility,
    toggleStreetViewLayers,
    addLayerToMap,
    removeLayerFromMap,
    setLayerShownInSelector,
    setGroupShownInSelector,


    // Search results layer management
    createSearchResultsLayer,
    updateSearchResultsData,
    updateSearchResultsHoverState,
    removeSearchResultsLayer,
  }
}
