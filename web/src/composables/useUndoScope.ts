import { onScopeDispose, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useHistoryStore, type UndoScope } from '@/stores/history.store'

/** Take the undo keys for this component's own stack while `active` holds. */
export function useUndoScope(
  scope: UndoScope,
  active: MaybeRefOrGetter<boolean> = true,
) {
  const history = useHistoryStore()
  let release: (() => void) | undefined

  watch(
    () => toValue(active),
    on => {
      release?.()
      release = on ? history.claim(scope) : undefined
    },
    { immediate: true },
  )

  onScopeDispose(() => release?.())
}
