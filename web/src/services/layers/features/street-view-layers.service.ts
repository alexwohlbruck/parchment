/**
 * Street View Layers Service
 * 
 * Handles street view-specific layer operations including bulk visibility toggles.
 * Street view layers include Mapillary and other street-level imagery layers.
 */

import type { Layer } from '@/types/map.types'
import { LayerType } from '@/types/map.types'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'

export function useStreetViewLayersService() {
  // ============================================================================
  // BULK VISIBILITY OPERATIONS
  // ============================================================================

  /**
   * Toggle visibility for all street view layers
   */
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
      // Visibility lives in the local override map (localStorage-backed),
      // not on the server. See layers.store.ts `updateLayerVisibility`.
      layersStore.updateLayerVisibility(layer.id, newState)

      if (mapStrategy) {
        mapStrategy.toggleLayerVisibility(layer.configuration.id, newState)
      }
    }
  }

  return {
    toggleStreetViewLayers,
  }
}
