import { ref, computed } from 'vue'
import { useDragRegistration } from './useDragState'
import type { Layer } from '@/types/map.types'

export function useDragAndDrop() {
  const { isDragging, startDrag, endDrag } = useDragRegistration('layers')

  // Get draggable options for main list (ungrouped layers)
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
    touchStartThreshold: 5,
    forceFallback: true,
    fallbackTolerance: 3,
    fallbackOnBody: true,
    swapThreshold: 0.65,
    emptyInsertThreshold: 5,
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
    touchStartThreshold: 5,
    forceFallback: true,
    fallbackTolerance: 3,
    fallbackOnBody: true,
    swapThreshold: 0.65,
    emptyInsertThreshold: 5,
    sort: true,
  }))

  // Handle drag start
  function onDragStart() {
    startDrag()
    triggerHapticFeedback('start')
  }

  // Handle drag end
  function onDragEnd() {
    endDrag()
    triggerHapticFeedback('end')
  }

  // Handle drag move
  function onDragMove() {
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      triggerHapticFeedback('move')
    }
  }

  // Haptic feedback
  // TODO: Use Tauri APIs
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

  // Get unique key for Layer
  function getLayerKey(layer: Layer): string {
    return layer.id || `layer-${Date.now()}-${Math.random()}`
  }

  return {
    isDragging,
    mainDragOptions,
    groupDragOptions,
    onDragStart,
    onDragEnd,
    onDragMove,
    getLayerKey,
  }
}
