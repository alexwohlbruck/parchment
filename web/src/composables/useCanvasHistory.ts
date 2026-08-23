/**
 * Undo and redo for the canvas being edited.
 *
 * Snapshots of the working copy rather than a log of operations: a canvas
 * body is small, saved whole anyway, and every edit already replaces it — so
 * a stack of snapshots is both simpler and impossible to get out of step with
 * the document.
 *
 * Edits are coalesced, so typing a name is one step back rather than one per
 * keystroke, and a drag is one step rather than one per frame.
 */

import { computed, ref, watch, type Ref } from 'vue'
import type { CanvasBody } from '@/types/canvas.types'

/** How long edits keep merging into the same step. */
const COALESCE_MS = 400
/** Far more than anyone reaches for, and still nothing in memory terms. */
const LIMIT = 100

export function useCanvasHistory(body: Ref<CanvasBody>) {
  const past = ref<string[]>([])
  const future = ref<string[]>([])

  /** The snapshot the stacks are relative to. */
  let current = JSON.stringify(body.value)
  /** Set while undo/redo is writing, so its own change isn't recorded. */
  let applying = false
  let timer: ReturnType<typeof setTimeout> | undefined
  /** When the last step was opened, so quick edits merge into it. */
  let openedAt = 0

  function record() {
    const next = JSON.stringify(body.value)
    if (next === current) return

    const now = Date.now()
    // Inside the window, the step already on the stack absorbs this edit —
    // it still ends at the newest state, it just started earlier.
    if (!(past.value.length && now - openedAt < COALESCE_MS)) {
      past.value = [...past.value, current].slice(-LIMIT)
      openedAt = now
    }
    current = next
    future.value = []
  }

  watch(
    body,
    () => {
      if (applying) return
      // Debounced so a drag or a burst of typing lands as one entry, and so
      // the snapshot is taken once the edit has settled.
      clearTimeout(timer)
      timer = setTimeout(record, 0)
    },
    { deep: true },
  )

  function apply(snapshot: string) {
    applying = true
    clearTimeout(timer)
    body.value = JSON.parse(snapshot)
    current = snapshot
    openedAt = 0
    // Released after the watcher has seen the write and skipped it.
    queueMicrotask(() => {
      applying = false
    })
  }

  function undo() {
    // An edit still inside the coalescing window hasn't been recorded yet.
    if (timer) {
      clearTimeout(timer)
      timer = undefined
      record()
    }
    const previous = past.value[past.value.length - 1]
    if (previous === undefined) return
    past.value = past.value.slice(0, -1)
    future.value = [...future.value, current]
    apply(previous)
  }

  function redo() {
    const next = future.value[future.value.length - 1]
    if (next === undefined) return
    future.value = future.value.slice(0, -1)
    past.value = [...past.value, current]
    apply(next)
  }

  /** Forget everything — a different canvas has been loaded into the editor. */
  function reset() {
    clearTimeout(timer)
    timer = undefined
    past.value = []
    future.value = []
    current = JSON.stringify(body.value)
    openedAt = 0
  }

  return {
    undo,
    redo,
    reset,
    canUndo: computed(() => past.value.length > 0),
    canRedo: computed(() => future.value.length > 0),
  }
}
