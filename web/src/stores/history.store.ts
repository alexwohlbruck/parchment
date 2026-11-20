import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import { i18n } from '@/lib/i18n'
import { toast } from '@/lib/toast'
import type { AllowInInput } from '@/stores/hotkey.store'

/** A change that can be taken back. Both sides may hit the network. */
export interface HistoryEntry {
  /** What happened, in the user's words: "Removed Blue Bottle from Coffee". */
  label: string
  /** What taking it back does, in the same words: "Put Blue Bottle back in Coffee". */
  undoneLabel?: string
  undo: () => unknown
  redo: () => unknown
}

/** A view with an undo stack of its own, which takes ⌘Z while it is open. */
export interface UndoScope {
  undo: () => void
  redo: () => void
  allowInInput?: AllowInInput
}

const LIMIT = 50
const TOAST_ID = 'history'

/**
 * App-wide undo for changes to the user's library. Views that edit something
 * in place (a canvas, a measurement, a route being drawn) claim a scope, and
 * ⌘Z goes to the newest one until it is released.
 */
export const useHistoryStore = defineStore('history', () => {
  const t = (key: string, params?: Record<string, unknown>) =>
    (i18n.global as any).t(key, params)

  const past = shallowRef<HistoryEntry[]>([])
  const future = shallowRef<HistoryEntry[]>([])
  const scopes = shallowRef<UndoScope[]>([])
  let replaying = false

  const canUndo = computed(() => past.value.length > 0)
  const canRedo = computed(() => future.value.length > 0)
  const activeScope = computed(() => scopes.value.at(-1))

  type ToastAction = { label: string; onClick: () => void }

  /** The toast for a change: Undo, or Undo beside the change's own action. */
  function notify(message: string, undoOrRedo: ToastAction, view?: ToastAction) {
    toast.success(message, {
      id: TOAST_ID,
      ...(view ? { action: view, cancel: undoOrRedo } : { action: undoOrRedo }),
    })
  }

  const undoAction = (): ToastAction => ({ label: t('general.undo'), onClick: undo })
  const redoAction = (): ToastAction => ({ label: t('general.redo'), onClick: redo })

  /**
   * Remember a change the user just made, and offer to take it back. A quiet
   * change goes on the stack without a toast: a toggle the user can see flip.
   */
  function record(
    entry: HistoryEntry,
    options: { view?: ToastAction; quiet?: boolean } = {},
  ) {
    // Undo and redo go back through the same services that record.
    if (replaying) return
    past.value = [...past.value, entry].slice(-LIMIT)
    future.value = []
    if (!options.quiet) notify(entry.label, undoAction(), options.view)
  }

  async function step(from: typeof past, to: typeof past, direction: 'undo' | 'redo') {
    const entry = from.value.at(-1)
    if (!entry || replaying) return
    from.value = from.value.slice(0, -1)
    replaying = true
    try {
      await entry[direction]()
      to.value = [...to.value, entry]
      if (direction === 'undo') {
        notify(entry.undoneLabel ?? t('history.undone'), redoAction())
      } else {
        notify(entry.label, undoAction())
      }
    } catch (error) {
      toast.error(t(`history.${direction}Failed`), { cause: error })
    } finally {
      replaying = false
    }
  }

  const undo = () => step(past, future, 'undo')
  const redo = () => step(future, past, 'redo')

  /** Route ⌘Z to `scope` until the returned function is called. */
  function claim(scope: UndoScope) {
    scopes.value = [...scopes.value, scope]
    return () => {
      scopes.value = scopes.value.filter(s => s !== scope)
    }
  }

  /** What the undo keys do right now: the newest scope, else the library. */
  function undoKey() {
    return activeScope.value ? activeScope.value.undo() : undo()
  }

  function redoKey() {
    return activeScope.value ? activeScope.value.redo() : redo()
  }

  /** A text field keeps its own ⌘Z unless the open scope asks for it. */
  function keyAllowedIn(element: Element) {
    const allow = activeScope.value?.allowInInput
    return typeof allow === 'function' ? allow(element) : !!allow
  }

  function clear() {
    past.value = []
    future.value = []
  }

  return {
    canUndo,
    canRedo,
    record,
    undo,
    redo,
    claim,
    undoKey,
    redoKey,
    keyAllowedIn,
    clear,
  }
})
