import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Layer, LayerGroup, LayerGroupWithLayers } from '@/types/map.types'
import { useLayersService } from '@/services/layers/layers.service'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useStorage } from '@vueuse/core'
import { jsonSerializer } from '@/lib/storage'
import {
  CORE_LAYERS,
  CORE_LAYER_IDS,
  serverUrl,
} from '@/constants/layer.constants'

export const useLayersStore = defineStore('layers', () => {
  const layersService = useLayersService()
  const integrationsStore = useIntegrationsStore()

  const cachedUserLayers = useStorage<Layer[] | null>(
    'parchment-user-layers',
    null,
    undefined,
    { serializer: jsonSerializer },
  )
  const cachedLayerGroups = useStorage<LayerGroup[] | null>(
    'parchment-layer-groups',
    null,
    undefined,
    { serializer: jsonSerializer },
  )

  const userLayers = ref<Layer[]>(
    Array.isArray(cachedUserLayers.value) ? cachedUserLayers.value : [],
  )
  const layerGroups = ref<LayerGroup[]>(
    Array.isArray(cachedLayerGroups.value) ? cachedLayerGroups.value : [],
  )
  const isSyncing = ref(false)
  const isLoadingLayers = ref(false)

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

  // Filter user layers by integration availability
  const filteredUserLayers = computed(() => {
    const arr = Array.isArray(userLayers.value) ? userLayers.value : []
    return arr.filter(layer => {
      if (!layer.integrationId) return true
      return integrationsStore.configuredIntegrations.some(
        i => i.id.toLowerCase() === layer.integrationId!.toLowerCase(),
      )
    })
  })

  // All layers (core + user layers filtered by integration)
  const layers = computed(() => [
    ...coreLayers.value,
    ...filteredUserLayers.value,
  ])

  // All layer groups (user groups only now, no more client-side groups)
  const allLayerGroups = computed(() => layerGroups.value)

  // Nested group tree
  interface GroupTreeNode extends LayerGroup {
    layers: Layer[]
    children: GroupTreeNode[]
  }

  function buildGroupNode(group: LayerGroup): GroupTreeNode {
    return {
      ...group,
      layers: filteredUserLayers.value
        .filter(l => l.groupId === group.id)
        .sort((a, b) => a.order - b.order),
      children: layerGroups.value
        .filter(g => g.parentGroupId === group.id)
        .sort((a, b) => a.order - b.order)
        .map(buildGroupNode),
    }
  }

  const groupTree = computed(() => {
    const topLevel = layerGroups.value.filter(g => !g.parentGroupId)
    return topLevel.sort((a, b) => a.order - b.order).map(buildGroupNode)
  })

  // UI display computed properties

  // Get total layer count for a group including all descendants (sub-layers included)
  function getGroupTotalLayerCount(groupId: string): number {
    const directLayers = filteredUserLayers.value.filter(l => l.groupId === groupId)
    const childGroups = layerGroups.value.filter(g => g.parentGroupId === groupId)
    return directLayers.length + childGroups.reduce((sum, g) => sum + getGroupTotalLayerCount(g.id), 0)
  }

  // For the settings/library panel: show ALL layers and groups (except sub-layers)
  const ungroupedLayers = computed(() => {
    return filteredUserLayers.value
      .filter(layer => !layer.groupId && !layer.isSubLayer)
      .sort((a, b) => a.order - b.order)
  })

  const sortedGroups = computed(() =>
    allLayerGroups.value.slice().sort((a, b) => a.order - b.order),
  )

  const groupsWithLayers = computed<LayerGroupWithLayers[]>(() =>
    sortedGroups.value.map(group => ({
      ...group,
      layers: filteredUserLayers.value
        .filter(
          layer => layer.groupId === group.id && !layer.isSubLayer,
        )
        .sort((a, b) => a.order - b.order),
    })),
  )

  // Mixed list of ungrouped layers and top-level groups for the settings panel reordering
  const mainReorderableItems = computed(() => {
    const userUngrouped = filteredUserLayers.value.filter(
      layer => !layer.groupId && !layer.isSubLayer,
    )
    const topLevelGroups = layerGroups.value.filter(g => !g.parentGroupId)

    const items: (Layer | LayerGroup)[] = [...userUngrouped, ...topLevelGroups]
    return items.sort((a, b) => a.order - b.order)
  })

  // ============================================================================
  // LOADING
  // ============================================================================

  async function loadLayers() {
    const hasCachedData =
      Array.isArray(cachedUserLayers.value) ||
      Array.isArray(cachedLayerGroups.value)

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
      cachedUserLayers.value = layersData
      cachedLayerGroups.value = groupsData
    } finally {
      isLoadingLayers.value = false
    }
  }

  /**
   * Initialize default layers for a new user (or provision missing defaults).
   * Called once on app startup after loadLayers.
   */
  async function initializeDefaults() {
    try {
      const result = await layersService.initializeDefaults()
      if (result.layersCreated > 0 || result.groupsCreated > 0) {
        // Defaults were provisioned - reload to pick them up
        const [layersData, groupsData] = await Promise.all([
          layersService.getLayers(),
          layersService.getLayerGroups(),
        ])
        userLayers.value = layersData
        layerGroups.value = groupsData
        cachedUserLayers.value = layersData
        cachedLayerGroups.value = groupsData
      }
      return result
    } catch (error) {
      console.error('Failed to initialize default layers:', error)
      return { success: false, layersCreated: 0, groupsCreated: 0 }
    }
  }

  /**
   * Restore default layers by removing user's cloned overrides.
   */
  async function restoreDefaults() {
    try {
      const result = await layersService.restoreDefaults()
      // Re-initialize defaults after removing overrides
      await initializeDefaults()
      return result
    } catch (error) {
      console.error('Failed to restore defaults:', error)
      return { success: false, restoredLayers: 0, restoredGroups: 0 }
    }
  }

  // ============================================================================
  // CACHE SYNC HELPERS
  // ============================================================================

  function syncLayersToCache() {
    cachedUserLayers.value = [...userLayers.value]
  }

  function syncGroupsToCache() {
    cachedLayerGroups.value = [...layerGroups.value]
  }

  // ============================================================================
  // LAYER CRUD
  // ============================================================================

  async function addLayer(
    layer: Omit<Layer, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
  ) {
    const newLayer = await layersService.createLayer(layer)
    userLayers.value.push(newLayer)
    syncLayersToCache()
    return newLayer
  }

  async function updateLayer(id: string, updates: Partial<Layer>) {
    if (Object.values(CORE_LAYER_IDS).includes(id as any)) {
      console.warn('Cannot update core layer:', id)
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
    if (Object.values(CORE_LAYER_IDS).includes(id as any)) {
      console.warn('Cannot remove core layer:', id)
      return
    }

    await layersService.deleteLayer(id)
    userLayers.value = (
      Array.isArray(userLayers.value) ? userLayers.value : []
    ).filter(l => l.id !== id)
    syncLayersToCache()
  }

  // ============================================================================
  // LAYER GROUP CRUD
  // ============================================================================

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

  // ============================================================================
  // VISIBILITY (OPTIMISTIC)
  // ============================================================================

  function updateLayerVisibility(layerId: string, visible: boolean) {
    const layer = layers.value.find(l => l.id === layerId)
    if (layer) {
      layer.visible = visible
    }
  }

  function toggleLayerGroupVisibility(groupId: string, visible: boolean) {
    const group = allLayerGroups.value.find(g => g.id === groupId)
    if (group) {
      group.visible = visible
    }
  }

  // ============================================================================
  // DRAG AND DROP / REORDERING
  // ============================================================================

  async function handleMainReorder(newItems: (Layer | LayerGroup)[]) {
    const updates: { id: string; order: number; groupId?: string | null }[] = []

    newItems.forEach((item, index) => {
      if ('groupId' in item) {
        const layer = userLayers.value.find(l => l.id === item.id)
        if (layer) {
          layer.order = index
          layer.groupId = null
        }
        updates.push({ id: item.id, order: index, groupId: null })
      } else {
        const group = layerGroups.value.find(g => g.id === item.id)
        if (group) {
          group.order = index
        }
        updates.push({ id: item.id, order: index })
      }
    })

    await syncReorderWithServer(updates)
  }

  async function handleUngroupedReorder(newLayers: Layer[]) {
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

    await syncReorderWithServer(updates)
  }

  async function handleGroupReorder(groupId: string, newLayers: Layer[]) {
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

    await syncReorderWithServer(updates)
  }

  async function handleLayerMove(
    layerId: string,
    newGroupId: string | null,
    newIndex: number,
  ) {
    const movingLayer = userLayers.value.find(l => l.id === layerId)
    if (!movingLayer) return

    const oldGroupId = movingLayer.groupId

    const targetLayers = newGroupId
      ? userLayers.value.filter(
          l => l.groupId === newGroupId && l.id !== layerId,
        )
      : userLayers.value.filter(l => !l.groupId && l.id !== layerId)

    targetLayers.sort((a, b) => a.order - b.order)

    const reorderedLayers = [...targetLayers]
    reorderedLayers.splice(newIndex, 0, movingLayer)

    movingLayer.groupId = newGroupId
    reorderedLayers.forEach((layer, index) => {
      layer.order = index
      layer.groupId = newGroupId
    })

    if (oldGroupId !== newGroupId && oldGroupId !== null) {
      const oldGroupLayers = userLayers.value
        .filter(l => l.groupId === oldGroupId)
        .sort((a, b) => a.order - b.order)
      oldGroupLayers.forEach((layer, index) => {
        layer.order = index
      })
    }

    isSyncing.value = true
    try {
      await layersService.moveLayer(layerId, newGroupId, newIndex)
      syncLayersToCache()
    } catch (error) {
      console.error('Failed to sync layer move with server:', error)
      await loadLayers()
    } finally {
      isSyncing.value = false
    }
  }

  async function syncReorderWithServer(
    updates: { id: string; order: number; groupId?: string | null }[],
  ) {
    isSyncing.value = true
    try {
      const success = await layersService.reorderLayers(updates)
      if (success) {
        syncLayersToCache()
        syncGroupsToCache()
      } else {
        await loadLayers()
      }
    } catch (error) {
      console.error('Failed to sync reorder with server:', error)
      await loadLayers()
    } finally {
      isSyncing.value = false
    }
  }

  // ============================================================================
  // SERVER URL CHANGE WATCHER
  // ============================================================================

  watch(serverUrl, async (newUrl, oldUrl) => {
    if (newUrl !== oldUrl) {
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
    layers,
    userLayers,
    coreLayers,
    layerGroups,
    allLayerGroups,
    isSyncing,
    isLoadingLayers,
    // Computed
    ungroupedLayers,
    groupsWithLayers,
    mainReorderableItems,
    groupTree,
    getGroupTotalLayerCount,
    // Data operations
    loadLayers,
    initializeDefaults,
    restoreDefaults,
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
    // Cache
    clearCache,
  }
})
