import mitt from 'mitt'
import { computed, ref, toRaw } from 'vue'

// Helper function to get layer ID from either structure
function getLayerId(layer: any): string | undefined {
  return layer?.configuration?.id || layer?.id
}
import { defineStore } from 'pinia'
import {
  Basemap,
  MapEngine,
  MapSettings,
  MapEvents,
  Layer,
  LayerGroup,
  LayerItem,
  MapCamera,
  MapTheme,
  Pegman,
  MapProjection,
} from '@/types/map.types'
import { layers as defaultLayers } from '@/components/map/layers/layers'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { useStorage } from '@vueuse/core'

const emitter = mitt<MapEvents>()

const defaultSettings: MapSettings = {
  theme: MapTheme.LIGHT,
  engine: MapEngine.MAPBOX,
  projection: MapProjection.GLOBE,
  basemap: 'standard',
  terrain3d: false,
  objects3d: true,
  poiLabels: true,
  roadLabels: true,
  transitLabels: true,
  placeLabels: true,
}

export const useMapStore = defineStore('map', () => {
  let mapStrategy: MapStrategy
  function setMapStrategy(map: MapStrategy) {
    mapStrategy = map
  }

  const settings = useStorage<MapSettings>('map', defaultSettings)

  const mapCamera = useStorage<MapCamera>('map-camera', {
    center: [-44.808291513887866, 21.851187958608364],
    zoom: 2,
    bearing: 0,
    pitch: 0,
  })

  function setMapCamera(camera: MapCamera) {
    mapCamera.value = camera
  }

  // Event methods
  function on<K extends keyof MapEvents>(
    event: K,
    handler: (data: MapEvents[K]) => void,
  ) {
    emitter.on(event, handler)
  }

  function off<K extends keyof MapEvents>(
    event: K,
    handler: (data: MapEvents[K]) => void,
  ) {
    emitter.off(event, handler)
  }

  function emit<K extends keyof MapEvents>(event: K, data: MapEvents[K]) {
    emitter.emit(event, data)
  }

  // Initialize layers with order properties
  const layersWithOrder = defaultLayers.map((layer, index) => ({
    ...layer,
    order: index,
  }))

  const layers = useStorage<Layer[]>('map-layers', layersWithOrder)
  const layerGroups = useStorage<LayerGroup[]>('map-layer-groups', [])

  const enabledLayers = computed(() =>
    layers.value.filter(
      layer =>
        layer && layer.enabled && layer.engine?.includes(settings.value.engine),
    ),
  )

  // Get layers organized as a unified list of groups and individual layers
  const layerItems = computed((): LayerItem[] => {
    // Helper to safely get order
    const getOrder = (item: any): number => item?.order ?? 0

    // Get ungrouped layers
    const ungroupedLayers = layers.value
      .filter(layer => layer && !layer.groupId)
      .sort((a, b) => getOrder(a) - getOrder(b))

    // Get groups with their layers
    const groupsWithLayers = layerGroups.value
      .map(group => ({
        ...group,
        layers: layers.value
          .filter(layer => layer && layer.groupId === group.id)
          .sort((a, b) => getOrder(a) - getOrder(b)),
      }))
      .sort((a, b) => getOrder(a) - getOrder(b))

    // Create the items array with proper typing
    const items: LayerItem[] = []

    // Combine all items and sort by order
    const allItems = [
      ...groupsWithLayers.map(group => ({
        type: 'group' as const,
        order: getOrder(group),
        data: group,
      })),
      ...ungroupedLayers.map(layer => ({
        type: 'layer' as const,
        order: getOrder(layer),
        data: layer,
      })),
    ].sort((a, b) => a.order - b.order)

    // Build the final items array with proper types
    allItems.forEach(item => {
      if (item.type === 'group') {
        items.push({ type: 'group', data: item.data })
      } else {
        items.push({ type: 'layer', data: item.data })
      }
    })

    return items
  })

  // Layer management functions
  function initializeLayers(layers_: Layer[]) {
    layers_.forEach(layer => {
      mapStrategy?.addLayer(layer)
    })
  }

  function addLayer(layer: Layer) {
    const newLayer = {
      ...layer,
      order: layer.order ?? layers.value.length,
    }
    layers.value.push(newLayer)
    if (newLayer.enabled) {
      mapStrategy?.addLayer(newLayer)
    }
  }

  function removeLayer(layerId: Layer['configuration']['id']) {
    const index = layers.value.findIndex(layer => getLayerId(layer) === layerId)
    if (index !== -1) {
      const layer = layers.value[index]
      if (layer.enabled) {
        mapStrategy?.removeLayer(layerId)
      }
      layers.value.splice(index, 1)
    }
  }

  function updateLayer(updatedLayer: Layer) {
    const layer = layers.value.find(
      layer => getLayerId(layer) === getLayerId(updatedLayer),
    )
    if (!layer) return

    // Update properties of existing layer object to maintain reactivity
    Object.assign(layer, updatedLayer)

    const layerId = getLayerId(layer)
    if (layerId) {
      mapStrategy?.removeLayer(layerId)
      if (typeof layer.configuration?.source === 'object') {
        mapStrategy?.removeSource(layer.configuration.source.id)
      }
      mapStrategy?.addLayer(layer)
    }
  }

  function toggleLayer(
    layerId: Layer['configuration']['id'],
    enabled?: boolean,
  ) {
    const layer = layers.value.find(layer => getLayerId(layer) === layerId)
    if (!layer) return

    const newEnabled = enabled ?? !layer.enabled
    const updatedLayer = { ...layer, enabled: newEnabled }

    updateLayer(updatedLayer)
  }

  function toggleLayerVisibility(
    layerId: Layer['configuration']['id'],
    visible: boolean,
  ) {
    const layer = layers.value.find(layer => getLayerId(layer) === layerId)
    if (layer) {
      layer.visible = visible
      if (layer.enabled) {
        mapStrategy?.toggleLayerVisibility(layerId, visible)
      }
    }
  }

  function reorderLayers(reorderedLayers: Layer[]) {
    // Update order properties based on new array position
    reorderedLayers.forEach((layer, index) => {
      layer.order = index
    })
    layers.value = reorderedLayers
  }

  function moveLayerToGroup(layerId: string, groupId: string | null) {
    const layer = layers.value.find(l => getLayerId(l) === layerId)
    if (layer) {
      layer.groupId = groupId || undefined

      // If moving to a group, set order relative to group
      if (groupId) {
        const groupLayers = layers.value.filter(l => l.groupId === groupId)
        layer.order = groupLayers.length
      }
    }
  }

  // Layer group management functions
  function addLayerGroup(
    group: Omit<LayerGroup, 'id' | 'createdAt' | 'updatedAt'>,
  ) {
    const newGroup: LayerGroup = {
      ...group,
      id: `group-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      order: group.order ?? layerGroups.value.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    layerGroups.value.push(newGroup)
    return newGroup
  }

  function updateLayerGroup(groupId: string, updates: Partial<LayerGroup>) {
    const group = layerGroups.value.find(g => g.id === groupId)
    if (group) {
      Object.assign(group, {
        ...updates,
        updatedAt: new Date().toISOString(),
      })
    }
  }

  function removeLayerGroup(groupId: string) {
    const groupIndex = layerGroups.value.findIndex(g => g.id === groupId)
    if (groupIndex !== -1) {
      // Move all layers from this group to ungrouped
      layers.value.forEach(layer => {
        if (layer.groupId === groupId) {
          layer.groupId = undefined
        }
      })
      layerGroups.value.splice(groupIndex, 1)
    }
  }

  function toggleLayerGroup(groupId: string, enabled?: boolean) {
    const group = layerGroups.value.find(g => g.id === groupId)
    if (!group) return

    const newEnabled = enabled ?? !group.enabled
    group.enabled = newEnabled

    // Toggle all layers in the group
    const groupLayers = layers.value.filter(layer => layer.groupId === groupId)
    groupLayers.forEach(layer => {
      const layerId = getLayerId(layer)
      if (layerId) {
        toggleLayer(layerId, newEnabled)
      }
    })
  }

  function toggleLayerGroupVisibility(groupId: string, visible?: boolean) {
    const group = layerGroups.value.find(g => g.id === groupId)
    if (!group) return

    const newVisible = visible ?? !group.visible
    group.visible = newVisible

    // Toggle visibility of all layers in the group
    const groupLayers = layers.value.filter(layer => layer.groupId === groupId)
    groupLayers.forEach(layer => {
      const layerId = getLayerId(layer)
      if (layerId) {
        toggleLayerVisibility(layerId, newVisible)
      }
    })
  }

  function reorderLayerGroups(reorderedGroups: LayerGroup[]) {
    reorderedGroups.forEach((group, index) => {
      group.order = index
    })
    layerGroups.value = reorderedGroups
  }

  const pegman = ref<Pegman | null>(null)

  function setPegman(pegman_: Pegman) {
    pegman.value = pegman_
  }

  function clearPegman() {
    pegman.value = null
  }

  return {
    setMapStrategy,
    settings,
    mapCamera,
    setMapCamera,
    on,
    off,
    emit,
    layers,
    layerGroups,
    enabledLayers,
    layerItems,
    initializeLayers,
    addLayer,
    removeLayer,
    updateLayer,
    toggleLayer,
    toggleLayerVisibility,
    reorderLayers,
    moveLayerToGroup,
    addLayerGroup,
    updateLayerGroup,
    removeLayerGroup,
    toggleLayerGroup,
    toggleLayerGroupVisibility,
    reorderLayerGroups,
    pegman,
    setPegman,
    clearPegman,
  }
})
