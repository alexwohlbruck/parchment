/**
 * Transit Layers Service
 *
 * Handles transit-specific layer operations including bulk visibility toggles
 * and transit stop click handlers for navigation.
 */

import type { Layer } from '@/types/map.types'
import { LayerType, MapColorTheme } from '@/types/map.types'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { isTransitStopLayer } from '@/lib/transit.utils'
import { useThemeStore } from '@/stores/theme.store'

export function useTransitLayersService() {
  const router = useRouter()
  const themeStore = useThemeStore()

  // ============================================================================
  // TRANSIT STOP CLICK HANDLERS
  // ============================================================================

  /**
   * Add click handlers for transit stops to open place detail view
   */
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

  // ============================================================================
  // BULK VISIBILITY OPERATIONS
  // ============================================================================

  /**
   * Toggle visibility for all transit layers
   */
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
      if (layer.id.startsWith('client-')) {
        // For client-side layers, only update in memory
        layersStore.updateLayerVisibility(layer.id, newState)
      } else {
        // For user layers, update on server
        await layersStore.updateLayer(layer.id, { visible: newState })
      }

      if (mapStrategy) {
        mapStrategy.toggleLayerVisibility(layer.configuration.id, newState)
      }
    }

    // Set map color theme and transit labels based on transit layer visibility
    if (mapStrategy) {
      applyTransitMapTheme(mapStrategy, newState)
    }
  }

  /**
   * Check if any transit layers are visible
   */
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

  /**
   * Apply map color theme based on transit visibility and theme
   */
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

  return {
    addTransitStopClickHandlers,
    toggleTransitLayers,
    checkTransitLayersVisibility,
    applyTransitMapTheme,
  }
}
