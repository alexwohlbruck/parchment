import { api } from '@/lib/api'
import type { Layer, LayerGroup } from '@/types/map.types'
import { LayerType } from '@/types/map.types'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { toRaw } from 'vue'

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
      mapStrategy.addLayer(plainLayer)
    })
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
  }
}
