/**
 * Fix for RekaUI bug: Non-modal dialogs close when another non-modal dialog closes
 * Composable to coordinate multiple non-modal drawers
 * Prevents focus-outside events from closing drawers when another drawer is dismissing
 */

import { ref } from 'vue'

const dismissingDrawers = ref(new Set<string>())
const lastDismissTime = ref<number>(0)

// Time window to ignore focus events after a drawer dismisses
const FOCUS_GRACE_PERIOD = 50

export function useDrawerCoordination() {
  /**
   * Register that a drawer is starting to close
   */
  function registerDismissing(drawerId: string) {
    dismissingDrawers.value.add(drawerId)
    lastDismissTime.value = Date.now()
  }

  /**
   * Register that a drawer has finished closing
   */
  function unregisterDismissing(drawerId: string) {
    dismissingDrawers.value.delete(drawerId)
    if (dismissingDrawers.value.size === 0) {
      lastDismissTime.value = Date.now()
    }
  }

  /**
   * Check if any drawer is currently dismissing or recently dismissed
   */
  function isDismissing(): boolean {
    const hasActivelyDismissing = dismissingDrawers.value.size > 0
    const isInGracePeriod =
      Date.now() - lastDismissTime.value < FOCUS_GRACE_PERIOD
    return hasActivelyDismissing || isInGracePeriod
  }

  return {
    registerDismissing,
    unregisterDismissing,
    isDismissing,
  }
}
