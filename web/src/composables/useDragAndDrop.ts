import { ref, computed } from 'vue'
import { useMapStore } from '@/stores/map.store'
import type { Layer, LayerGroup, LayerItem } from '@/types/map.types'

interface DragItem {
  id: string
  type: 'layer' | 'group'
  data: Layer | LayerGroup
}

export function useDragAndDrop() {
  const mapStore = useMapStore()
  const isDragging = ref(false)

  // Convert LayerItem to DragItem for consistent drag operations
  function toDragItem(item: LayerItem): DragItem {
    if (item.type === 'group') {
      return {
        id: item.data.id,
        type: 'group',
        data: item.data,
      }
    } else {
      return {
        id: item.data.configuration?.id || '',
        type: 'layer',
        data: item.data,
      }
    }
  }

  // Convert Layer to DragItem
  function layerToDragItem(layer: Layer): DragItem {
    return {
      id: layer.configuration?.id || '',
      type: 'layer',
      data: layer,
    }
  }

  // Get draggable options for main list
  const mainDragOptions = computed(() => ({
    animation: 200,
    group: {
      name: 'layers',
      pull: true,
      put: true,
    },
    ghostClass: 'drag-ghost',
    chosenClass: 'drag-chosen',
    dragClass: 'drag-active',
    disabled: false,
    delay: 0,
    delayOnTouchStart: true,
    touchStartThreshold: 0,
  }))

  // Get draggable options for group lists
  const groupDragOptions = computed(() => ({
    animation: 200,
    group: {
      name: 'layers',
      pull: true,
      put: true,
    },
    ghostClass: 'drag-ghost',
    chosenClass: 'drag-chosen',
    dragClass: 'drag-active',
    disabled: false,
    delay: 0,
    delayOnTouchStart: true,
    touchStartThreshold: 0,
    sort: true,
  }))

  // Handle drag start
  function onDragStart() {
    isDragging.value = true
    triggerHapticFeedback('start')
  }

  // Handle drag end
  function onDragEnd() {
    isDragging.value = false
    triggerHapticFeedback('end')
  }

  // Handle drag move
  function onDragMove() {
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      triggerHapticFeedback('move')
    }
  }

  // Haptic feedback
  function triggerHapticFeedback(type: 'start' | 'end' | 'move' = 'start') {
    if ('vibrate' in navigator) {
      const patterns = {
        start: [50],
        move: [20],
        end: [30, 10, 30],
      }
      navigator.vibrate(patterns[type])
    }
  }

  // Handle main list changes (items added/removed/moved)
  function handleMainListChange(evt: any, newItems: LayerItem[]) {
    try {
      if (evt.added) {
        // Item was moved from a group to main list
        const element = evt.added.element
        const newIndex = evt.added.newIndex

        // Handle both Layer objects (from groups) and LayerItem objects (from main)
        let layerId: string | undefined

        if (element?.configuration?.id) {
          // Direct Layer object from group
          layerId = element.configuration.id
        } else if (element?.data?.configuration?.id) {
          // LayerItem structure from main list
          layerId = element.data.configuration.id
        }

        if (layerId) {
          mapStore.moveLayerToGroup(layerId, null)

          // Set the order based on drop position BEFORE the computed setter runs
          const layerIndex = mapStore.layers.findIndex(
            l => l.configuration?.id === layerId,
          )
          if (layerIndex !== -1) {
            mapStore.layers[layerIndex].order = newIndex
          }
        }
      }
      // Let computed setter handle same-container reordering
    } catch (error) {
      console.error('Error in handleMainListChange:', error)
    }
  }

  // Handle group list changes
  function handleGroupChange(groupId: string, evt: any, newLayers: Layer[]) {
    try {
      if (evt.added) {
        // Item was moved to this group
        const element = evt.added.element
        const newIndex = evt.added.newIndex

        // Handle both Layer objects (from other groups) and LayerItem objects (from main)
        let layerId: string | undefined

        if (element?.configuration?.id) {
          // Direct Layer object from another group
          layerId = element.configuration.id
        } else if (element?.data?.configuration?.id) {
          // LayerItem structure from main list
          layerId = element.data.configuration.id
        }

        if (layerId) {
          mapStore.moveLayerToGroup(layerId, groupId)

          // Set the order based on drop position within the group BEFORE computed setter runs
          const layerIndex = mapStore.layers.findIndex(
            l => l.configuration?.id === layerId,
          )
          if (layerIndex !== -1) {
            mapStore.layers[layerIndex].order = newIndex
          }
        }
      }
      // Let computed setter handle same-container reordering
    } catch (error) {
      console.error(`Error in handleGroupChange for group ${groupId}:`, error)
    }
  }

  // Get unique key for drag items
  function getDragItemKey(item: DragItem): string {
    return `${item.type}-${item.id}`
  }

  // Get unique key for LayerItem
  function getLayerItemKey(item: LayerItem): string {
    if (item.type === 'group') {
      return `group-${item.data.id}`
    }
    return `layer-${item.data.configuration?.id || 'unknown'}`
  }

  // Get unique key for Layer
  function getLayerKey(layer: Layer): string {
    return layer.configuration?.id || `layer-${Date.now()}-${Math.random()}`
  }

  return {
    isDragging,
    mainDragOptions,
    groupDragOptions,
    onDragStart,
    onDragEnd,
    onDragMove,
    handleMainListChange,
    handleGroupChange,
    toDragItem,
    layerToDragItem,
    getDragItemKey,
    getLayerItemKey,
    getLayerKey,
  }
}
