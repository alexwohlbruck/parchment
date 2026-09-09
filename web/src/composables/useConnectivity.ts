import { getCurrentScope, onScopeDispose } from 'vue'
import {
  checkConnectivityNow,
  connectivityStatus,
  isOffline,
  onReconnected as onReconnectedGlobal,
} from '@/lib/connectivity'

/**
 * Component-facing connectivity API. `isOffline` / `status` are app-wide
 * reactive state; `onReconnected` registers a callback for each
 * offline → online transition and unregisters with the current scope —
 * the standard way for a screen to refetch what it skipped while offline.
 */
export function useConnectivity() {
  function onReconnected(cb: () => void): () => void {
    const stop = onReconnectedGlobal(cb)
    if (getCurrentScope()) onScopeDispose(stop)
    return stop
  }

  return {
    isOffline,
    status: connectivityStatus,
    onReconnected,
    checkNow: checkConnectivityNow,
  }
}
