/**
 * Layer Visibility Service
 * 
 * Manages layer visibility state and map integration for showing/hiding layers.
 * Handles both individual layers and layer groups.
 */

import type { Layer, LayerGroup } from '@/types/map.types'
import { LayerType, MapColorTheme } from '@/types/map.types'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { toRaw } from 'vue'
import { useThemeStore } from '@/stores/theme.store'

export function useLayerVisibilityService() {
  const themeStore = useThemeStore()

  // ============================================================================
  // VISIBILITY TOGGLE FUNCTIONS
  // ============================================================================

  /**
   * Toggle a single layer's visibility on the map
   */
  function toggleLayerVisibility(
    layerId: Layer['configuration']['id'],
    visible: boolean,
    mapStrategy?: MapStrategy,
  ) {
    if (mapStrategy) {
      mapStrategy.toggleLayerVisibility(layerId, visible)
    }
  }

  /**
   * Set visibility for a layer (updates store and map)
   */
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

    // Handle special layer types (transit layers need theme updates)
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

  /**
   * Toggle visibility for all layers in a group
   */
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
      if (layer.id.startsWith('client-')) {
        // For client-side layers, only update in memory
        layersStore.updateLayerVisibility(layer.id, visible)
      } else {
        // For user layers, update on server
        await layersStore.updateLayer(layer.id, { visible })
      }
      toggleLayerVisibility(layer.configuration.id, visible, mapStrategy)
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

  /**
   * Set show-in-selector state for a layer (does not affect map visibility)
   */
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

  /**
   * Set show-in-selector state for a group
   */
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

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

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
   * Apply map color theme based on transit visibility
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
    toggleLayerVisibility,
    setLayerVisibility,
    toggleLayerGroupVisibility,
    setLayerShownInSelector,
    setGroupShownInSelector,
    checkTransitLayersVisibility,
    applyTransitMapTheme,
  }
}
