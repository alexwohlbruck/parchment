/**
 * Layer Visibility Service
 *
 * Manages layer visibility state and map integration for showing/hiding layers.
 * Visibility is ephemeral UI state — only updated in memory and on the map,
 * never persisted to the server.
 */

import type { Layer, LayerGroup } from '@/types/map.types'
import { LayerType, MapColorTheme } from '@/types/map.types'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
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
   * Set visibility for a layer (updates in-memory store and map — no server call)
   */
  function setLayerVisibility(
    layerConfigId: Layer['configuration']['id'],
    layers: Layer[],
    layersStore: any,
    mapStrategy?: MapStrategy,
    state?: boolean,
    allLayerGroups?: LayerGroup[],
  ) {
    const layer = layers.find(l => l.configuration.id === layerConfigId)
    if (!layer) return

    const newState = state ?? !layer.visible

    // Update in-memory store only (no HTTP request)
    layersStore.updateLayerVisibility(layer.id, newState)

    // Update map visualization
    toggleLayerVisibility(layerConfigId, newState, mapStrategy)

    // Check if this layer or its group has fadeBasemap
    const layerGroup = layer.groupId && allLayerGroups
      ? allLayerGroups.find(g => g.id === layer.groupId)
      : undefined
    const hasFadeBasemap = layer.fadeBasemap || layerGroup?.fadeBasemap

    // Handle fadeBasemap layers
    if (hasFadeBasemap && mapStrategy) {
      const hasVisibleFadeBasemapLayers = checkFadeBasemapVisibility(
        layers,
        layerConfigId,
        newState,
        allLayerGroups,
      )
      applyFadedBasemap(mapStrategy, hasVisibleFadeBasemapLayers)
    }

    // Handle transit-specific logic (case layer toggle, transit label hiding)
    if (layer.type === LayerType.TRANSIT && mapStrategy) {
      // For Transitland layers, also toggle the case layer
      if (layer.configuration.id === 'transitland') {
        const caseLayer = layers.find(
          l => l.configuration.id === 'transitland-case',
        )
        if (caseLayer) {
          layersStore.updateLayerVisibility(caseLayer.id, newState)
          toggleLayerVisibility('transitland-case', newState, mapStrategy)
        }
      }

      // Hide native transit labels when our transit layers are active
      const hasVisibleTransitLayers = layers.some(l => {
        if (l.type !== LayerType.TRANSIT) return false
        if (l.configuration.id === layerConfigId) return newState
        return l.visible
      })
      mapStrategy.setTransitLabels(!hasVisibleTransitLayers)
    }
  }

  /**
   * Toggle visibility for all layers in a group (in-memory only — no server calls)
   */
  function toggleLayerGroupVisibility(
    group: LayerGroup,
    visible: boolean,
    layersStore: any,
    layers: Layer[],
    mapStrategy?: MapStrategy,
    allLayerGroups?: LayerGroup[],
  ) {
    // Collect this group and all descendant group IDs
    const affectedGroupIds = new Set<string>([group.id])
    if (allLayerGroups) {
      function collectChildGroupIds(parentId: string) {
        for (const g of allLayerGroups!) {
          if (g.parentGroupId === parentId && !affectedGroupIds.has(g.id)) {
            affectedGroupIds.add(g.id)
            layersStore.toggleLayerGroupVisibility(g.id, visible)
            collectChildGroupIds(g.id)
          }
        }
      }
      collectChildGroupIds(group.id)
    }

    // Update group visibility in-memory
    layersStore.toggleLayerGroupVisibility(group.id, visible)

    // Find all layers in this group and its descendant groups
    const groupLayers = layers.filter(l => l.groupId && affectedGroupIds.has(l.groupId))

    // Check if this group or its layers have fadeBasemap or transit layers
    const hasFadeBasemapLayers = group.fadeBasemap || groupLayers.some(l => l.fadeBasemap)
    const hasTransitLayers = groupLayers.some(l => l.type === LayerType.TRANSIT)

    // Update each layer's visibility in-memory (including sub-layers)
    for (const layer of groupLayers) {
      layersStore.updateLayerVisibility(layer.id, visible)
      toggleLayerVisibility(layer.configuration.id, visible, mapStrategy)
    }

    // Apply basemap fade if this group or its layers have fadeBasemap
    if (hasFadeBasemapLayers && mapStrategy) {
      const hasVisibleFadeBasemapLayers = layers.some(l => {
        if (!l.fadeBasemap && !(group.fadeBasemap && l.groupId && affectedGroupIds.has(l.groupId))) return false
        if (l.groupId && affectedGroupIds.has(l.groupId)) return visible
        return l.visible
      })
      applyFadedBasemap(mapStrategy, hasVisibleFadeBasemapLayers)
    }

    // Handle transit label visibility separately
    if (hasTransitLayers && mapStrategy) {
      const hasVisibleTransitLayers = layers.some(l => {
        if (l.type !== LayerType.TRANSIT) return false
        if (l.groupId && affectedGroupIds.has(l.groupId)) return visible
        return l.visible
      })
      mapStrategy.setTransitLabels(!hasVisibleTransitLayers)
    }
  }

  /**
   * Set show-in-selector state for a layer (this IS a definition change — persists to server)
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
   * Set show-in-selector state for a group (this IS a definition change — persists to server)
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
   * Check if any fadeBasemap layers are visible
   */
  function checkFadeBasemapVisibility(
    layers: Layer[],
    layerConfigId?: string,
    newState?: boolean,
    allLayerGroups?: LayerGroup[],
  ): boolean {
    const fadeBasemapGroupIds = allLayerGroups
      ? new Set(allLayerGroups.filter(g => g.fadeBasemap).map(g => g.id))
      : new Set<string>()

    return layers.some(l => {
      const hasFade = l.fadeBasemap || (l.groupId && fadeBasemapGroupIds.has(l.groupId))
      if (!hasFade) return false

      // If this is the layer being updated, use the new state
      if (layerConfigId && l.configuration.id === layerConfigId) {
        return newState ?? false
      }

      // Otherwise use current visibility
      return l.visible
    })
  }

  /**
   * Apply basemap fade effect based on fadeBasemap layer visibility
   */
  function applyFadedBasemap(
    mapStrategy: MapStrategy,
    hasVisibleFadeBasemapLayers: boolean,
  ) {
    // Only apply faded effect in light mode when fadeBasemap layers are visible
    const shouldUseFaded = hasVisibleFadeBasemapLayers && !themeStore.isDark
    mapStrategy.setMapColorTheme(
      shouldUseFaded ? MapColorTheme.FADED : MapColorTheme.DEFAULT,
    )
  }

  return {
    toggleLayerVisibility,
    setLayerVisibility,
    toggleLayerGroupVisibility,
    setLayerShownInSelector,
    setGroupShownInSelector,
    checkFadeBasemapVisibility,
    applyFadedBasemap,
  }
}
