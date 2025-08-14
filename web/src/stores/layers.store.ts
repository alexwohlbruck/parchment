import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Layer, LayerGroup, LayerGroupWithLayers } from '@/types/map.types'
import { useLayersService } from '@/services/layers.service'

export const useLayersStore = defineStore('layers', () => {
  const layersService = useLayersService()

  const layers = ref<Layer[]>([])
  const layerGroups = ref<LayerGroup[]>([])
  const isSyncing = ref(false) // Track when syncing with server

  // Simple computed properties - no complex denormalization
  const ungroupedLayers = computed(() =>
    layers.value
      .filter(layer => !layer.groupId)
      .sort((a, b) => a.order - b.order),
  )

  const sortedGroups = computed(() =>
    layerGroups.value.sort((a, b) => a.order - b.order),
  )

  const groupsWithLayers = computed<LayerGroupWithLayers[]>(() =>
    sortedGroups.value.map(group => ({
      ...group,
      layers: layers.value
        .filter(layer => layer.groupId === group.id)
        .sort((a, b) => a.order - b.order),
    })),
  )

  // Mixed list of ungrouped layers and groups for main reordering
  const mainReorderableItems = computed(() => {
    const items: (Layer | LayerGroup)[] = [
      ...ungroupedLayers.value,
      ...sortedGroups.value,
    ]
    return items.sort((a, b) => a.order - b.order)
  })

  // Load layers and groups from server
  async function loadLayers() {
    const [layersData, groupsData] = await Promise.all([
      layersService.getLayers(),
      layersService.getLayerGroups(),
    ])

    layers.value = layersData
    layerGroups.value = groupsData
  }

  // Layer operations
  async function addLayer(
    layer: Omit<Layer, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
  ) {
    const newLayer = await layersService.createLayer(layer)
    layers.value.push(newLayer)
    return newLayer
  }

  async function updateLayer(id: string, updates: Partial<Layer>) {
    const updatedLayer = await layersService.updateLayer(id, updates)
    const index = layers.value.findIndex(l => l.id === id)
    if (index !== -1) {
      layers.value[index] = updatedLayer
    }
    return updatedLayer
  }

  async function removeLayer(id: string) {
    await layersService.deleteLayer(id)
    layers.value = layers.value.filter(l => l.id !== id)
  }

  // Layer group operations
  async function addLayerGroup(
    group: Omit<LayerGroup, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
  ) {
    const newGroup = await layersService.createLayerGroup(group)
    layerGroups.value.push(newGroup)
    return newGroup
  }

  async function updateLayerGroup(id: string, updates: Partial<LayerGroup>) {
    const updatedGroup = await layersService.updateLayerGroup(id, updates)
    const index = layerGroups.value.findIndex(g => g.id === id)
    if (index !== -1) {
      layerGroups.value[index] = updatedGroup
    }
    return updatedGroup
  }

  async function removeLayerGroup(id: string) {
    await layersService.deleteLayerGroup(id)
    layerGroups.value = layerGroups.value.filter(g => g.id !== id)
  }

  // Optimistic visibility updates
  function updateLayerVisibility(layerId: string, visible: boolean) {
    const layer = layers.value.find(l => l.id === layerId)
    if (layer) {
      layer.visible = visible
    }
  }

  function toggleLayerGroupVisibility(groupId: string, visible: boolean) {
    const group = layerGroups.value.find(g => g.id === groupId)
    if (group) {
      group.visible = visible
    }
  }

  // Optimistic drag and drop handlers - update UI immediately, sync with server in background
  async function handleMainReorder(newItems: (Layer | LayerGroup)[]) {
    console.log('=== Frontend handleMainReorder ===')
    console.log(
      'newItems received (in order):',
      newItems.map((item, index) => ({
        arrayIndex: index,
        id: item.id,
        name: 'name' in item ? item.name : 'Unknown',
        currentOrderProperty: item.order,
        type: 'groupId' in item ? 'layer' : 'group',
      })),
    )

    // Optimistically update local state immediately
    const updates: { id: string; order: number; groupId?: string | null }[] = []

    newItems.forEach((item, index) => {
      if ('groupId' in item) {
        // It's a layer - update local state
        const layer = layers.value.find(l => l.id === item.id)
        if (layer) {
          layer.order = index
          layer.groupId = null // Main list only contains ungrouped layers
        }
        updates.push({ id: item.id, order: index, groupId: null })
      } else {
        // It's a group - update local state
        const group = layerGroups.value.find(g => g.id === item.id)
        if (group) {
          group.order = index
        }
        updates.push({ id: item.id, order: index })
      }
    })

    console.log('Updates to send:', updates)

    // Sync with server in background
    await syncReorderWithServer(updates)
  }

  async function handleUngroupedReorder(newLayers: Layer[]) {
    // Optimistically update local state
    newLayers.forEach((layer, index) => {
      const localLayer = layers.value.find(l => l.id === layer.id)
      if (localLayer) {
        localLayer.order = index
        localLayer.groupId = null
      }
    })

    const updates = newLayers.map((layer, index) => ({
      id: layer.id,
      order: index,
      groupId: null,
    }))

    // Sync with server in background
    await syncReorderWithServer(updates)
  }

  async function handleGroupReorder(groupId: string, newLayers: Layer[]) {
    // Optimistically update local state
    newLayers.forEach((layer, index) => {
      const localLayer = layers.value.find(l => l.id === layer.id)
      if (localLayer) {
        localLayer.order = index
        localLayer.groupId = groupId
      }
    })

    const updates = newLayers.map((layer, index) => ({
      id: layer.id,
      order: index,
      groupId,
    }))

    // Sync with server in background
    await syncReorderWithServer(updates)
  }

  async function handleLayerMove(
    layerId: string,
    newGroupId: string | null,
    newIndex: number,
  ) {
    console.log('=== Optimistic handleLayerMove ===')
    console.log(
      'Moving layer:',
      layerId,
      'to group:',
      newGroupId,
      'at index:',
      newIndex,
    )

    // Find the layer being moved
    const movingLayer = layers.value.find(l => l.id === layerId)
    if (!movingLayer) {
      console.error('Layer not found:', layerId)
      return
    }

    const oldGroupId = movingLayer.groupId
    console.log('Moving from group:', oldGroupId, 'to group:', newGroupId)

    // Get target group layers (excluding the moving layer)
    const targetLayers = newGroupId
      ? layers.value.filter(l => l.groupId === newGroupId && l.id !== layerId)
      : layers.value.filter(l => !l.groupId && l.id !== layerId)

    console.log('Target group has', targetLayers.length, 'existing layers')

    // Sort target layers by current order
    targetLayers.sort((a, b) => a.order - b.order)

    // Insert moving layer at target position
    const reorderedLayers = [...targetLayers]
    reorderedLayers.splice(newIndex, 0, movingLayer)

    // Optimistically update local state immediately
    movingLayer.groupId = newGroupId
    reorderedLayers.forEach((layer, index) => {
      layer.order = index
      layer.groupId = newGroupId
    })

    // If layer came from a different group, reorder the old group
    if (oldGroupId !== newGroupId && oldGroupId !== null) {
      const oldGroupLayers = layers.value
        .filter(l => l.groupId === oldGroupId)
        .sort((a, b) => a.order - b.order)

      oldGroupLayers.forEach((layer, index) => {
        layer.order = index
      })
    }

    console.log('Optimistic update complete')

    // Sync with server in background
    isSyncing.value = true
    try {
      await layersService.moveLayer(layerId, newGroupId, newIndex)
      console.log('Server sync successful')
    } catch (error) {
      console.error('Failed to sync layer move with server:', error)
      // On error, refresh from server to restore correct state
      await loadLayers()
    } finally {
      isSyncing.value = false
    }
  }

  // Private helper function for syncing reorder operations
  async function syncReorderWithServer(
    updates: { id: string; order: number; groupId?: string | null }[],
  ) {
    isSyncing.value = true
    try {
      const success = await layersService.reorderLayers(updates)
      if (success) {
        console.log('Reorder sync successful')
      } else {
        console.error('Reorder sync failed')
        await loadLayers()
      }
    } catch (error) {
      console.error('Failed to sync reorder with server:', error)
      // On error, refresh from server to restore correct state
      await loadLayers()
    } finally {
      isSyncing.value = false
    }
  }

  return {
    // State
    layers,
    layerGroups,
    isSyncing,
    // Computed
    ungroupedLayers,
    groupsWithLayers,
    mainReorderableItems,
    // Data operations
    loadLayers,
    addLayer,
    updateLayer,
    removeLayer,
    addLayerGroup,
    updateLayerGroup,
    removeLayerGroup,
    // Optimistic updates
    updateLayerVisibility,
    toggleLayerGroupVisibility,
    // Drag and drop
    handleMainReorder,
    handleUngroupedReorder,
    handleGroupReorder,
    handleLayerMove,
  }
})
