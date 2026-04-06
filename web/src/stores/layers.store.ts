import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Layer, LayerGroup, LayerGroupWithLayers } from '@/types/map.types'
import { LayerType } from '@/types/map.types'
import { useLayersService } from '@/services/layers/layers.service'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useStorage } from '@vueuse/core'
import { STORAGE_KEYS, jsonSerializer } from '@/lib/storage'
import {
  CORE_LAYERS,
  CORE_LAYER_IDS,
  USER_LAYER_TEMPLATES,
  USER_LAYER_GROUP_TEMPLATES,
  CLIENT_SIDE_LAYERS,
  CLIENT_SIDE_LAYER_GROUP_TEMPLATES,
  LAYER_INTEGRATION_REQUIREMENTS,
} from '@/constants/layer.constants'
import { appStorage } from '@/stores/app.store'
// Helper function to generate IDs
function generateId(): string {
  return `layer-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export const useLayersStore = defineStore('layers', () => {
  const layersService = useLayersService()
  const integrationsStore = useIntegrationsStore()

  interface LayersState {
    userLayers: Layer[] | null
    layerGroups: LayerGroup[] | null
    clientLayerGroups: Record<string, boolean>
    clientLayers: Record<string, boolean>
  }

  const stored = useStorage<LayersState>(
    STORAGE_KEYS.LAYERS,
    {
      userLayers: null,
      layerGroups: null,
      clientLayerGroups: {},
      clientLayers: {},
    },
    undefined,
    { serializer: jsonSerializer },
  )

  const cachedUserLayers = computed({
    get: () => stored.value.userLayers,
    set: (v: Layer[] | null) => { stored.value.userLayers = v },
  })
  const cachedLayerGroups = computed({
    get: () => stored.value.layerGroups,
    set: (v: LayerGroup[] | null) => { stored.value.layerGroups = v },
  })

  const userLayers = ref<Layer[]>(
    Array.isArray(cachedUserLayers.value) ? cachedUserLayers.value : [],
  )
  const layerGroups = ref<LayerGroup[]>(
    Array.isArray(cachedLayerGroups.value) ? cachedLayerGroups.value : [],
  )
  const isSyncing = ref(false) // Track when syncing with server
  const isLoadingLayers = ref(false) // Track initial layer load

  const clientSideGroupVisibility = computed({
    get: () => stored.value.clientLayerGroups,
    set: (v: Record<string, boolean>) => { stored.value.clientLayerGroups = v },
  })

  const clientSideLayerVisibility = computed({
    get: () => stored.value.clientLayers,
    set: (v: Record<string, boolean>) => { stored.value.clientLayers = v },
  })

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

  // Client-side layers that are never persisted to database
  const clientSideLayers = computed(() => {
    // Filter by integration requirements
    return CLIENT_SIDE_LAYERS.value
      .filter(layer => {
        const configId = layer.configuration?.id
        if (!configId) return true

        const requiredIntegration =
          LAYER_INTEGRATION_REQUIREMENTS[
            configId as keyof typeof LAYER_INTEGRATION_REQUIREMENTS
          ]
        if (!requiredIntegration) return true

        // Check if required integration is configured
        return integrationsStore.configuredIntegrations.some(
          integration => integration.id.toLowerCase() === requiredIntegration,
        )
      })
      .map((layerTemplate, index) => {
        const layerId = `client-${layerTemplate.configuration.id}`
        return {
          ...layerTemplate,
          id: layerId,
          userId: 'client',
          groupId:
            layerTemplate.groupId === 'Mapillary'
              ? 'client-mapillary'
              : layerTemplate.groupId === 'Transit'
                ? 'client-transit'
                : layerTemplate.groupId,
          // Use persistent visibility state, fallback to template default
          visible:
            clientSideLayerVisibility.value[layerId] ?? layerTemplate.visible,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      })
  })

  // Client-side layer groups that are never persisted to database
  const clientSideLayerGroups = computed(() => {
    return CLIENT_SIDE_LAYER_GROUP_TEMPLATES.value
      .filter(group => {
        // Only show groups that have at least one visible layer
        return clientSideLayers.value.some(
          layer => layer.groupId === `client-${group.name.toLowerCase()}`,
        )
      })
      .map((groupTemplate, index) => {
        const groupId = `client-${groupTemplate.name.toLowerCase()}`
        return {
          ...groupTemplate,
          id: groupId,
          userId: 'client',
          // Use persistent visibility state, fallback to template default
          visible:
            clientSideGroupVisibility.value[groupId] ?? groupTemplate.visible,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      })
  })

  // All layers (core + client-side + user layers), filtered by integrations
  const layers = computed(() => {
    // Filter user layers based on integration requirements
    const filteredUserLayers = (
      Array.isArray(userLayers.value) ? userLayers.value : []
    ).filter(layer => {
      const configId = layer.configuration?.id
      if (!configId) return true

      const requiredIntegration =
        LAYER_INTEGRATION_REQUIREMENTS[
          configId as keyof typeof LAYER_INTEGRATION_REQUIREMENTS
        ]
      if (!requiredIntegration) return true

      // Check if required integration is configured
      return integrationsStore.configuredIntegrations.some(
        integration => integration.id.toLowerCase() === requiredIntegration,
      )
    })

    return [
      ...coreLayers.value,
      ...clientSideLayers.value,
      ...filteredUserLayers,
    ]
  })

  // All layer groups (client-side + user groups)
  const allLayerGroups = computed(() => {
    return [...clientSideLayerGroups.value, ...layerGroups.value]
  })

  // Sync client-side layer visibility with their group visibility on initialization
  function syncClientSideLayerVisibility() {
    let hasVisibleTransitLayers = false

    for (const group of clientSideLayerGroups.value) {
      if (group.visible) {
        // If group is visible, ensure all its layers are also visible
        const groupLayers = clientSideLayers.value.filter(
          l => l.groupId === group.id,
        )
        for (const layer of groupLayers) {
          if (!layer.visible) {
            // Update both the layer state and localStorage
            layer.visible = true
            clientSideLayerVisibility.value[layer.id] = true
          }

          // Check if this is a transit layer
          if (layer.type === LayerType.TRANSIT) {
            hasVisibleTransitLayers = true
          }
        }
      }
    }

    return hasVisibleTransitLayers
  }

  // UI display computed properties (show both client-side and user layers, hide core layers)
  const ungroupedLayers = computed(() => {
    const clientUngrouped = clientSideLayers.value.filter(
      layer => !layer.groupId && layer.showInLayerSelector,
    )
    const userUngrouped = (
      Array.isArray(userLayers.value) ? userLayers.value : []
    ).filter(layer => !layer.groupId && layer.showInLayerSelector)
    return [...clientUngrouped, ...userUngrouped].sort(
      (a, b) => a.order - b.order,
    )
  })

  const sortedGroups = computed(() =>
    allLayerGroups.value.sort((a, b) => a.order - b.order),
  )

  const groupsWithLayers = computed<LayerGroupWithLayers[]>(() =>
    sortedGroups.value.map(group => ({
      ...group,
      layers: [...clientSideLayers.value, ...userLayers.value]
        .filter(
          layer => layer.groupId === group.id && layer.showInLayerSelector,
        )
        .sort((a, b) => a.order - b.order),
    })),
  )

  // Mixed list of ungrouped layers and groups for main reordering (excludes client-side items)
  const mainReorderableItems = computed(() => {
    const userUngrouped = (
      Array.isArray(userLayers.value) ? userLayers.value : []
    ).filter(layer => !layer.groupId && layer.showInLayerSelector)
    const userGroups = layerGroups.value.filter(
      group => group.showInLayerSelector,
    )
    const clientUngrouped = clientSideLayers.value.filter(
      layer => !layer.groupId && layer.showInLayerSelector,
    )
    const clientGroups = clientSideLayerGroups.value.filter(
      group => group.showInLayerSelector,
    )

    const items: (Layer | LayerGroup)[] = [
      ...clientUngrouped,
      ...clientGroups,
      ...userUngrouped,
      ...userGroups,
    ]
    return items.sort((a, b) => a.order - b.order)
  })

  // Load layers and groups from server (user layers only)
  // If cached data exists (is array), returns immediately and the fetch updates cache in background
  async function loadLayers() {
    // Array (even empty) = cached, null/other = never fetched
    const hasCachedData =
      Array.isArray(cachedUserLayers.value) ||
      Array.isArray(cachedLayerGroups.value)

    // If we have cached data, don't block - fetch will update in background
    if (hasCachedData) {
      Promise.all([layersService.getLayers(), layersService.getLayerGroups()])
        .then(([layersData, groupsData]) => {
          userLayers.value = layersData
          layerGroups.value = groupsData
          cachedUserLayers.value = layersData
          cachedLayerGroups.value = groupsData
        })
        .catch(error => {
          console.error('Failed to refresh layers:', error)
        })
      return
    }

    // No cache - must wait for server
    isLoadingLayers.value = true
    try {
      const [layersData, groupsData] = await Promise.all([
        layersService.getLayers(),
        layersService.getLayerGroups(),
      ])

      userLayers.value = layersData
      layerGroups.value = groupsData

      // Update cache
      cachedUserLayers.value = layersData
      cachedLayerGroups.value = groupsData
    } finally {
      isLoadingLayers.value = false
    }
  }

  // TODO: Create template "store" where users can import pre-made layers from the community
  // Populate user's account with template layers (replaces server-side populate endpoint)
  async function populateUserLayerTemplates() {
    // First, create layer groups that don't exist
    const existingGroupNames = new Set(layerGroups.value.map(g => g.name))

    for (const groupTemplate of USER_LAYER_GROUP_TEMPLATES.value) {
      if (!existingGroupNames.has(groupTemplate.name)) {
        // Check if this group requires integrations
        const hasRequiredIntegration =
          groupTemplate.name === 'Mapillary'
            ? integrationsStore.configuredIntegrations.some(
                i => i.id.toLowerCase() === 'mapillary',
              )
            : true

        if (hasRequiredIntegration) {
          await addLayerGroup(groupTemplate)
        }
      }
    }

    // Reload groups to get the created IDs
    await loadLayers()

    // Then create layers that don't exist
    const existingConfigIds = new Set(
      userLayers.value.map(l => l.configuration?.id).filter(Boolean),
    )

    for (const layerTemplate of USER_LAYER_TEMPLATES.value) {
      const configId = layerTemplate.configuration?.id
      if (configId && !existingConfigIds.has(configId)) {
        // Check integration requirements
        const requiredIntegration =
          LAYER_INTEGRATION_REQUIREMENTS[
            configId as keyof typeof LAYER_INTEGRATION_REQUIREMENTS
          ]
        const hasRequiredIntegration =
          !requiredIntegration ||
          integrationsStore.configuredIntegrations.some(
            i => i.id.toLowerCase() === requiredIntegration,
          )

        if (hasRequiredIntegration) {
          // Find group ID if this layer belongs to a group
          let groupId: string | null = null
          if (layerTemplate.groupId) {
            const group = layerGroups.value.find(
              g => g.name === layerTemplate.groupId,
            )
            groupId = group?.id || null
          }

          await addLayer({
            ...layerTemplate,
            groupId,
          })
        }
      }
    }
  }

  // Helper to sync userLayers to cache
  function syncLayersToCache() {
    cachedUserLayers.value = [...userLayers.value]
  }

  // Helper to sync layerGroups to cache
  function syncGroupsToCache() {
    cachedLayerGroups.value = [...layerGroups.value]
  }

  // Layer operations (user layers only)
  async function addLayer(
    layer: Omit<Layer, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
  ) {
    const newLayer = await layersService.createLayer(layer)
    userLayers.value.push(newLayer)
    syncLayersToCache()
    return newLayer
  }

  async function updateLayer(id: string, updates: Partial<Layer>) {
    // Don't allow updating core or client-side layers
    if (
      Object.values(CORE_LAYER_IDS).includes(id as any) ||
      id.startsWith('client-')
    ) {
      console.warn('Cannot update core or client-side layer:', id)
      return
    }

    const updatedLayer = await layersService.updateLayer(id, updates)
    const index = userLayers.value.findIndex(l => l.id === id)
    if (index !== -1) {
      userLayers.value[index] = updatedLayer
    }
    syncLayersToCache()
    return updatedLayer
  }

  async function removeLayer(id: string) {
    // Don't allow removing core or client-side layers
    if (
      Object.values(CORE_LAYER_IDS).includes(id as any) ||
      id.startsWith('client-')
    ) {
      console.warn('Cannot remove core or client-side layer:', id)
      return
    }

    await layersService.deleteLayer(id)
    userLayers.value = (
      Array.isArray(userLayers.value) ? userLayers.value : []
    ).filter(l => l.id !== id)
    syncLayersToCache()
  }

  // Layer group operations
  async function addLayerGroup(
    group: Omit<LayerGroup, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
  ) {
    const newGroup = await layersService.createLayerGroup(group)
    layerGroups.value.push(newGroup)
    syncGroupsToCache()
    return newGroup
  }

  async function updateLayerGroup(id: string, updates: Partial<LayerGroup>) {
    const updatedGroup = await layersService.updateLayerGroup(id, updates)
    const index = layerGroups.value.findIndex(g => g.id === id)
    if (index !== -1) {
      layerGroups.value[index] = updatedGroup
    }
    syncGroupsToCache()
    return updatedGroup
  }

  async function removeLayerGroup(id: string) {
    await layersService.deleteLayerGroup(id)
    layerGroups.value = layerGroups.value.filter(g => g.id !== id)
    syncGroupsToCache()
  }

  // Optimistic visibility updates
  function updateLayerVisibility(layerId: string, visible: boolean) {
    // Handle core, client-side, and user layers
    const layer = layers.value.find(l => l.id === layerId)
    if (layer) {
      // For client-side layers, we need to maintain their state in memory
      // since they're never persisted to the database
      layer.visible = visible

      // Persist visibility state for client-side layers
      if (layerId.startsWith('client-')) {
        clientSideLayerVisibility.value[layerId] = visible
      }
    }
  }

  function toggleLayerGroupVisibility(groupId: string, visible: boolean) {
    const group = allLayerGroups.value.find(g => g.id === groupId)
    if (group) {
      group.visible = visible

      // Persist visibility state for client-side groups
      if (groupId.startsWith('client-')) {
        clientSideGroupVisibility.value[groupId] = visible
      }
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
      ? (Array.isArray(userLayers.value) ? userLayers.value : []).filter(
          l => l.groupId === newGroupId && l.id !== layerId,
        )
      : (Array.isArray(userLayers.value) ? userLayers.value : []).filter(
          l => !l.groupId && l.id !== layerId,
        )

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
      // Sync optimistic updates to cache
      syncLayersToCache()
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
        // Sync optimistic updates to cache
        syncLayersToCache()
        syncGroupsToCache()
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

  // Watch for server URL changes and update existing proxy layers
  watch(() => appStorage.value.selectedServer, async (newUrl, oldUrl) => {
    if (newUrl !== oldUrl) {
      console.log('Server URL changed, updating proxy layers...')

      // Find layers that use proxy endpoints and need updating
      const layersToUpdate = (
        Array.isArray(userLayers.value) ? userLayers.value : []
      ).filter(layer => {
        if (
          typeof layer.configuration.source === 'object' &&
          layer.configuration.source.tiles
        ) {
          return layer.configuration.source.tiles.some(
            (tileUrl: string) =>
              tileUrl.includes('/proxy/') && tileUrl.includes(oldUrl),
          )
        }
        return false
      })

      // Update each layer's configuration
      for (const layer of layersToUpdate) {
        if (
          typeof layer.configuration.source === 'object' &&
          layer.configuration.source.tiles
        ) {
          const updatedTiles = layer.configuration.source.tiles.map(
            (tileUrl: string) => tileUrl.replace(oldUrl, newUrl),
          )

          await updateLayer(layer.id, {
            configuration: {
              ...layer.configuration,
              source: {
                ...layer.configuration.source,
                tiles: updatedTiles,
              },
            },
          })
          console.log(`Updated proxy URLs for layer: ${layer.configuration.id}`)
        }
      }
    }
  })

  // Clear all cached data (used on sign out)
  function clearCache() {
    userLayers.value = []
    layerGroups.value = []
    cachedUserLayers.value = null
    cachedLayerGroups.value = null
  }

  return {
    // State
    layers, // All layers (core + client-side + user)
    userLayers, // Only user layers
    coreLayers, // Only core layers
    clientSideLayers, // Only client-side layers
    layerGroups, // Only user layer groups
    allLayerGroups, // Both client-side and user groups
    isSyncing,
    isLoadingLayers,
    // Computed
    ungroupedLayers,
    groupsWithLayers,
    mainReorderableItems,
    // Data operations
    loadLayers,
    populateUserLayerTemplates,
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
    // Sync functions
    syncClientSideLayerVisibility,
    clearCache,
  }
})
