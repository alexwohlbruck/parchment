import type { Ref } from 'vue'

/**
 * Dismiss-with-celebration helper for modal dialogs. Keeps the dialog open
 * briefly so the user sees the success affordance (green check, "Done", etc.)
 * before the modal animates out.
 *
 * Usage:
 *   const dismiss = useDialogCompletion(isOpen, emit)
 *   // later, on a successful step:
 *   step.value = 'complete'
 *   dismiss()
 *
 * The emitted event name defaults to `complete` — override when a different
 * parent-side hook is expected.
 */
// Relaxed `emit` type — accepts the strict `defineEmits` signature of any
// dialog that declares a `complete` event, without forcing callers to
// upcast. The composable only calls emit with a single event name.
type CompleteEmit = (event: 'complete') => void

export function useDialogCompletion(
  isOpen: Ref<boolean>,
  emit: CompleteEmit,
  options?: { holdMs?: number },
): () => void {
  const holdMs = options?.holdMs ?? 1500
  return () => {
    setTimeout(() => {
      isOpen.value = false
      emit('complete')
    }, holdMs)
  }
}

/**
 * Wraps an async operation in a busy/error lifecycle so dialog buttons can
 * disable themselves during the in-flight ceremony without every handler
 * repeating the try/finally boilerplate.
 *
 * Usage:
 *   const run = useBusyOperation(busyFlag, errorRef)
 *   await run(async () => {
 *     const result = await identityStore.enrollPasskey('')
 *     if (!result.success) errorRef.value = result.error
 *   })
 *
 * - Sets `busy` true and clears `error` before invoking `fn`.
 * - Always resets `busy` on return, even if `fn` throws.
 * - Re-throws so callers can still bail out; it doesn't swallow.
 */
export function useBusyOperation(
  busy: Ref<boolean>,
  error: Ref<string | null>,
) {
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    busy.value = true
    error.value = null
    try {
      return await fn()
    } finally {
      busy.value = false
    }
  }
}
