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
      // Visibility is ephemeral UI state — always route through the store's
      // local override map (localStorage-backed) rather than the server CRUD
      // path. This keeps toggles cheap and cross-device sync is intentionally
      // not a goal for visibility.
      layersStore.updateLayerVisibility(layer.id, newState)

      if (mapStrategy) {
        mapStrategy.toggleLayerVisibility(layer.configuration.id, newState)
      }
    }

    // Apply basemap fade and transit label visibility
    if (mapStrategy) {
      const shouldUseFaded = newState && !themeStore.isDark
      mapStrategy.setMapColorTheme(
        shouldUseFaded ? MapColorTheme.FADED : MapColorTheme.DEFAULT,
      )
      mapStrategy.setTransitLabels(!newState)
    }
  }

  return {
    addTransitStopClickHandlers,
    toggleTransitLayers,
  }
}
