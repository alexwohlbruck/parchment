import { onUnmounted } from 'vue'

/**
 * Manages an AbortController tied to the calling component's lifecycle.
 *
 * `nextSignal()` aborts the current in-flight request and returns a fresh
 * AbortSignal for the next one. Call it at the start of every new read request
 * to cancel whatever was previously pending in the same scope.
 *
 * The controller is also automatically aborted on `onUnmounted` so no requests
 * can complete after the component is torn down.
 *
 * Only use for read (GET) requests. Never pass a signal to mutation requests.
 */
export function useAbortController() {
  let controller = new AbortController()

  function nextSignal(): AbortSignal {
    controller.abort()
    controller = new AbortController()
    return controller.signal
  }

  onUnmounted(() => controller.abort())

  return { nextSignal }
}
