/**
 * Layers Service (Main Coordinator)
 * 
 * Central coordinator for all layer-related operations. Delegates to specialized services
 * for specific functionality while providing a unified interface.
 * 
 * This service acts as a facade, composing functionality from:
 * - Core services (CRUD, visibility)
 * - Feature services (transit - for click handlers)
 * 
 * Note: Other feature-specific services (search results, place polygons, street view, markers)
 * are now called directly where they're used, rather than re-exported through this service.
 */

import type { Layer, LayerGroup } from '@/types/map.types'
import type { Place } from '@/types/place.types'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { toRaw } from 'vue'
import { isTransitStopLayer } from '@/lib/transit.utils'

/** Check if a layer is compatible with the current map engine */
function isLayerCompatible(layer: Layer, mapStrategy: MapStrategy): boolean {
  if (!layer.engine || layer.engine.length === 0) return true
  return layer.engine.includes(mapStrategy.options.engine)
}

// Import specialized services
import { useLayerCrudService } from './core/layer-crud.service'
import { useLayerVisibilityService } from './core/layer-visibility.service'
import { useSearchResultsLayerService } from './features/search-results-layer.service'
import { useTransitLayersService } from './features/transit-layers.service'

export function useLayersService() {
  // Initialize specialized services
  const crudService = useLayerCrudService()
  const visibilityService = useLayerVisibilityService()
  const searchResultsService = useSearchResultsLayerService()
  const transitService = useTransitLayersService()

  // ============================================================================
  // CORE CRUD OPERATIONS
  // Delegated to layer-crud.service.ts
  // ============================================================================

  const {
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
  } = crudService

  // ============================================================================
  // MAP INTEGRATION
  // ============================================================================

  /**
   * Initialize all layers on the map
   * This is called when the map loads or when the style changes
   */
  function initializeLayers(layers: Layer[], mapStrategy?: MapStrategy) {
    if (!mapStrategy) return

    layers.forEach(layer => {
      // Convert reactive proxy to plain object to avoid proxy issues
      const plainLayer = toRaw(layer)

      // Skip layers not compatible with the current map engine
      if (!isLayerCompatible(plainLayer, mapStrategy)) return

      // Special handling for search results layer: source + symbol layer are
      // both added inside initializeSearchResultsLayer so they stay in sync.
      if (plainLayer.id === searchResultsService.createSearchResultsLayer().id) {
        searchResultsService.initializeSearchResultsLayer(mapStrategy)
        return
      }

      // Add transit stop click handlers for transit stop layers
      if (isTransitStopLayer(plainLayer.configuration?.id)) {
        transitService.addTransitStopClickHandlers(mapStrategy, plainLayer.configuration.id)
      }

      // Add the layer to the map
      mapStrategy.addLayer(plainLayer)
    })
  }

  /**
   * Add a single layer to the map
   */
  function addLayerToMap(layer: Layer, mapStrategy?: MapStrategy) {
    if (!mapStrategy) return
    const plainLayer = toRaw(layer)
    if (!isLayerCompatible(plainLayer, mapStrategy)) return

    // Add transit stop click handlers for dynamically added transit stop layers
    if (isTransitStopLayer(plainLayer.configuration?.id)) {
      transitService.addTransitStopClickHandlers(mapStrategy, plainLayer.configuration.id)
    }

    mapStrategy.addLayer(plainLayer)
  }

  /**
   * Remove a layer from the map
   */
  function removeLayerFromMap(
    layerId: Layer['configuration']['id'],
    mapStrategy?: MapStrategy,
  ) {
    if (!mapStrategy) return
    mapStrategy.removeLayer(layerId)
  }

  // ============================================================================
  // VISIBILITY MANAGEMENT
  // Delegated to layer-visibility.service.ts
  // ============================================================================

  const {
    toggleLayerVisibility,
    setLayerVisibility,
    toggleLayerGroupVisibility,
    setLayerShownInSelector,
    setGroupShownInSelector,
  } = visibilityService

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  return {
    // Core CRUD operations
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

    // Map integration
    initializeLayers,
    addLayerToMap,
    removeLayerFromMap,

    // Visibility management
    toggleLayerVisibility,
    setLayerVisibility,
    toggleLayerGroupVisibility,
    setLayerShownInSelector,
    setGroupShownInSelector,
  }
}
