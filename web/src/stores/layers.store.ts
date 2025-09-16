import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Layer, LayerGroup, LayerGroupWithLayers } from '@/types/map.types'
import { useLayersService } from '@/services/layers.service'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { 
  CORE_LAYERS, 
  CORE_LAYER_IDS,
  USER_LAYER_TEMPLATES,
  USER_LAYER_GROUP_TEMPLATES,
  LAYER_INTEGRATION_REQUIREMENTS
} from '@/constants/layer.constants'
// Helper function to generate IDs
function generateId(): string {
  return `layer-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export const useLayersStore = defineStore('layers', () => {
  const layersService = useLayersService()
  const integrationsStore = useIntegrationsStore()

  const userLayers = ref<Layer[]>([]) // Only user-created layers from server
  const layerGroups = ref<LayerGroup[]>([])
  const isSyncing = ref(false) // Track when syncing with server

  // Core layers that are always present (hidden from user)
  const coreLayers = computed(() => {
    return CORE_LAYERS.map((layerTemplate, index) => ({
      ...layerTemplate,
      id: Object.values(CORE_LAYER_IDS)[index],
      userId: 'core',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }))
  })

  // All layers (core + user layers), filtered by integrations
  const layers = computed(() => {
    // Filter user layers based on integration requirements
    const filteredUserLayers = userLayers.value.filter(layer => {
      const configId = layer.configuration?.id
      if (!configId) return true
      
      const requiredIntegration = LAYER_INTEGRATION_REQUIREMENTS[configId as keyof typeof LAYER_INTEGRATION_REQUIREMENTS]
      if (!requiredIntegration) return true
      
      // Check if required integration is configured
      return integrationsStore.configuredIntegrations.some(
        integration => integration.id.toLowerCase() === requiredIntegration
      )
    })

    return [...coreLayers.value, ...filteredUserLayers]
  })

  // UI display computed properties (only show user layers, hide core layers)
  const ungroupedLayers = computed(() =>
    userLayers.value
      .filter(layer => !layer.groupId && layer.showInLayerSelector)
      .sort((a, b) => a.order - b.order),
  )

  const sortedGroups = computed(() =>
    layerGroups.value.sort((a, b) => a.order - b.order),
  )

  const groupsWithLayers = computed<LayerGroupWithLayers[]>(() =>
    sortedGroups.value.map(group => ({
      ...group,
      layers: userLayers.value
        .filter(layer => layer.groupId === group.id && layer.showInLayerSelector)
        .sort((a, b) => a.order - b.order),
    })),
  )

  // Mixed list of ungrouped layers and groups for main reordering (user layers only)
  const mainReorderableItems = computed(() => {
    const items: (Layer | LayerGroup)[] = [
      ...ungroupedLayers.value,
      ...sortedGroups.value,
    ]
    return items.sort((a, b) => a.order - b.order)
  })

  // Load layers and groups from server (user layers only)
  async function loadLayers() {
    const [layersData, groupsData] = await Promise.all([
      layersService.getLayers(),
      layersService.getLayerGroups(),
    ])

    userLayers.value = layersData
    layerGroups.value = groupsData
  }

  // TODO: Create template "store" where users can import pre-made layers from the community
  // Populate user's account with template layers (replaces server-side populate endpoint)
  async function populateUserLayerTemplates() {
    try {
      // First, create layer groups that don't exist
      const existingGroupNames = new Set(layerGroups.value.map(g => g.name))
      
      for (const groupTemplate of USER_LAYER_GROUP_TEMPLATES) {
        if (!existingGroupNames.has(groupTemplate.name)) {
          // Check if this group requires integrations
          const hasRequiredIntegration = groupTemplate.name === 'Mapillary' 
            ? integrationsStore.configuredIntegrations.some(i => i.id.toLowerCase() === 'mapillary')
            : true
            
          if (hasRequiredIntegration) {
            await addLayerGroup(groupTemplate)
          }
        }
      }

      // Reload groups to get the created IDs
      await loadLayers()

      // Then create layers that don't exist
      const existingConfigIds = new Set(userLayers.value.map(l => l.configuration?.id).filter(Boolean))

      for (const layerTemplate of USER_LAYER_TEMPLATES) {
        const configId = layerTemplate.configuration?.id
        if (configId && !existingConfigIds.has(configId)) {
          // Check integration requirements
          const requiredIntegration = LAYER_INTEGRATION_REQUIREMENTS[configId as keyof typeof LAYER_INTEGRATION_REQUIREMENTS]
          const hasRequiredIntegration = !requiredIntegration || 
            integrationsStore.configuredIntegrations.some(i => i.id.toLowerCase() === requiredIntegration)
            
          if (hasRequiredIntegration) {
            // Find group ID if this layer belongs to a group
            let groupId: string | null = null
            if (layerTemplate.groupId) {
              const group = layerGroups.value.find(g => g.name === layerTemplate.groupId)
              groupId = group?.id || null
            }

            await addLayer({
              ...layerTemplate,
              groupId,
            })
          }
        }
      }
    } catch (error) {
      console.error('Failed to populate user layer templates:', error)
    }
  }

  // Layer operations (user layers only)
  async function addLayer(
    layer: Omit<Layer, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
  ) {
    const newLayer = await layersService.createLayer(layer)
    userLayers.value.push(newLayer)
    return newLayer
  }

  async function updateLayer(id: string, updates: Partial<Layer>) {
    // Don't allow updating core layers
    if (Object.values(CORE_LAYER_IDS).includes(id as any)) {
      console.warn('Cannot update core layer:', id)
      return
    }
    
    const updatedLayer = await layersService.updateLayer(id, updates)
    const index = userLayers.value.findIndex(l => l.id === id)
    if (index !== -1) {
      userLayers.value[index] = updatedLayer
    }
    return updatedLayer
  }

  async function removeLayer(id: string) {
    // Don't allow removing core layers
    if (Object.values(CORE_LAYER_IDS).includes(id as any)) {
      console.warn('Cannot remove core layer:', id)
      return
    }
    
    await layersService.deleteLayer(id)
    userLayers.value = userLayers.value.filter(l => l.id !== id)
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
    // Handle both core and user layers
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
        // It's a layer - update local state (user layers only)
        const layer = userLayers.value.find(l => l.id === item.id)
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
    // Optimistically update local state (user layers only)
    newLayers.forEach((layer, index) => {
      const localLayer = userLayers.value.find(l => l.id === layer.id)
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
    // Optimistically update local state (user layers only)
    newLayers.forEach((layer, index) => {
      const localLayer = userLayers.value.find(l => l.id === layer.id)
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

    // Find the layer being moved (user layers only)
    const movingLayer = userLayers.value.find(l => l.id === layerId)
    if (!movingLayer) {
      console.error('Layer not found:', layerId)
      return
    }

    const oldGroupId = movingLayer.groupId
    console.log('Moving from group:', oldGroupId, 'to group:', newGroupId)

    // Get target group layers (excluding the moving layer)
    const targetLayers = newGroupId
      ? userLayers.value.filter(l => l.groupId === newGroupId && l.id !== layerId)
      : userLayers.value.filter(l => !l.groupId && l.id !== layerId)

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
      const oldGroupLayers = userLayers.value
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
    layers, // All layers (core + user)
    userLayers, // Only user layers
    coreLayers, // Only core layers
    layerGroups,
    isSyncing,
    // Computed
    ungroupedLayers,
    groupsWithLayers,
    mainReorderableItems,
    // Data operations
    loadLayers,
    populateUserLayerTemplates, // New function to populate templates
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
