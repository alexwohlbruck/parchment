/**
 * Undo and redo for the canvas being edited.
 *
 * One stack over everything the editor holds, not one per place it keeps
 * something. There used to be two — the in-progress vertices lived in the
 * drawing tool while committed marks lived in the body, and the shortcut
 * picked whichever looked applicable. The seam showed exactly where you would
 * expect: undo took back a point while a shape was open, then stopped working
 * the moment the shape was finished, because the thing to step back to was on
 * the other stack.
 *
 * So a step is a snapshot of the whole editor: the body, and whatever is
 * half-drawn. Undo walks back through placing a vertex, finishing a shape,
 * recolouring it and deleting it without caring which of those it is.
 *
 * Snapshots rather than a log of operations: every edit already replaces the
 * thing it edits, so a stack of snapshots is both simpler and impossible to
 * get out of step with the document.
 *
 * A snapshot is a flat set of values, each of which is replaced rather than
 * changed in place — that is what lets a step be the values themselves
 * rather than a copy of them. Steps share everything an edit did not touch,
 * so a hundred of them cost about as much as one, and a canvas carrying
 * megabytes of imported GeoJSON is never serialised to take a step at all.
 */

import { computed, shallowRef, watch, type Ref } from 'vue'

/**
 * How long an edit waits for the next one before its step closes.
 *
 * Measured from the last change rather than from the step opening, so a
 * continuous gesture — a slider at sixty frames a second — collapses into one
 * step however long it runs, while two deliberate clicks stay two steps
 * however fast they come.
 */
const IDLE_MS = 250
/**
 * Far more than anyone reaches for, and nothing in memory terms: steps share
 * every part of the document an edit did not touch.
 */
const LIMIT = 100

export function useCanvasHistory<T extends object>(options: {
  /**
   * Everything an undo would have to put back, flat: every value replaced
   * rather than mutated, so two snapshots differ exactly where an edit
   * landed.
   */
  snapshot: () => T
  restore: (snapshot: T) => void
  /**
   * True while a gesture is mid-flight — a freehand stroke laying down a
   * point per frame. Nothing is recorded until it finishes, so the stroke is
   * one step rather than several hundred.
   */
  busy?: Ref<boolean>
}) {
  // Shallow: a step holds the editor's own values, and making them reactive
  // all over again would both cost the walk and break the identity the
  // steps are compared by.
  const past = shallowRef<T[]>([])
  const future = shallowRef<T[]>([])

  const take = () => options.snapshot()

  /** Nothing moved: every part of the snapshot is the same object as before. */
  function unchanged(a: T, b: T) {
    const keys = Object.keys(a) as (keyof T)[]
    return (
      keys.length === Object.keys(b).length &&
      keys.every(key => Object.is(a[key], b[key]))
    )
  }

  /** The snapshot the stacks are relative to. */
  let current = take()
  /** Set while undo/redo is writing, so its own change isn't recorded. */
  let applying = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastChangeAt = 0

  function record() {
    clearTimeout(timer)
    timer = undefined
    if (options.busy?.value) return

    const next = take()
    if (unchanged(next, current)) return

    const now = Date.now()
    // Still inside the idle window: the step already on the stack absorbs
    // this edit. It ends at the newest state either way.
    if (!(past.value.length && now - lastChangeAt < IDLE_MS)) {
      past.value = [...past.value, current].slice(-LIMIT)
    }
    lastChangeAt = now
    current = next
    future.value = []
  }

  watch(
    () => (options.busy?.value ? current : take()),
    () => {
      if (applying) return
      // Deferred so the snapshot is taken once the edit has settled, and so
      // several refs changing together land as one step.
      clearTimeout(timer)
      timer = setTimeout(record, 0)
    },
  )

  function apply(snapshot: T) {
    applying = true
    clearTimeout(timer)
    timer = undefined
    options.restore(snapshot)
    current = snapshot
    lastChangeAt = 0
    // Released after the watcher has seen the write and skipped it.
    queueMicrotask(() => {
      applying = false
    })
  }

  /** Close the open step now, so the next edit starts a new one. */
  function checkpoint() {
    if (timer) record()
    lastChangeAt = 0
  }

  function undo() {
    // An edit still inside the idle window hasn't been recorded yet.
    checkpoint()
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
    current = take()
    lastChangeAt = 0
  }

  return {
    undo,
    redo,
    reset,
    checkpoint,
    canUndo: computed(() => past.value.length > 0),
    canRedo: computed(() => future.value.length > 0),
  }
}
