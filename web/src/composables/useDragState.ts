import { ref, computed } from 'vue'

/**
 * Global drag state management system
 *
 * This composable provides a centralized way to track active drag operations
 * across the entire application. When any component is dragging, other
 * gesture-based components (like BottomSheet) can disable their gestures
 * to prevent interference.
 *
 * Usage:
 * 1. Use `useDragState()` to check if any drag is active
 * 2. Use `useDragRegistration(componentName)` for easy drag state management
 * 3. Use `registerDrag(id)` and `unregisterDrag(id)` for manual control
 */

// Global drag state tracking
const activeDragOperations = ref(new Set<string>())

export function useDragState() {
  // Check if any drag operation is currently active
  const isDragActive = computed(() => activeDragOperations.value.size > 0)

  // Register a new drag operation
  function registerDrag(id: string) {
    activeDragOperations.value.add(id)
  }

  // Unregister a drag operation
  function unregisterDrag(id: string) {
    activeDragOperations.value.delete(id)
  }

  // Clear all drag operations (useful for cleanup)
  function clearAllDrags() {
    activeDragOperations.value.clear()
  }

  // Get all active drag operations (for debugging)
  function getActiveDrags(): string[] {
    return Array.from(activeDragOperations.value)
  }

  return {
    isDragActive,
    registerDrag,
    unregisterDrag,
    clearAllDrags,
    getActiveDrags,
  }
}

/**
 * Helper composable for components that need to manage their own drag states
 *
 * Example usage in a Vue component:
 * ```typescript
 * import { useDragRegistration } from '@/composables/useDragState'
 * import { onUnmounted } from 'vue'
 *
 * const { isDragging, startDrag, endDrag, cleanup } = useDragRegistration('my-component')
 *
 * // Call startDrag() when drag begins
 * // Call endDrag() when drag ends
 * // Call cleanup() on component unmount
 *
 * onUnmounted(cleanup)
 * ```
 */
export function useDragRegistration(componentName: string) {
  const { registerDrag, unregisterDrag } = useDragState()
  const isDragging = ref(false)

  // Generate a unique ID for this component instance
  const dragId = `${componentName}-${Date.now()}-${Math.random()}`

  function startDrag() {
    if (!isDragging.value) {
      isDragging.value = true
      registerDrag(dragId)
    }
  }

  function endDrag() {
    if (isDragging.value) {
      isDragging.value = false
      unregisterDrag(dragId)
    }
  }

  // Cleanup on unmount
  function cleanup() {
    endDrag()
  }

  return {
    isDragging,
    startDrag,
    endDrag,
    cleanup,
    dragId,
  }
}
