/**
 * Renaming a row in place: click its title, type, done.
 *
 * The panel's three kinds of row — a group, a layer, a mark — all name
 * things, and all name them the same way, so the field's behaviour lives
 * here rather than three times over. Enter and blur both commit, because a
 * name is a small enough edit that leaving it means keeping it; Escape puts
 * the old one back.
 */

import { nextTick, ref } from 'vue'

export function useInlineRename(options: {
  /** What it is called now. */
  value: () => string
  /** Called only when the name actually changed, and is not empty. */
  onCommit: (name: string) => void
}) {
  const renaming = ref(false)
  const draft = ref('')
  /** Bound to the field, which may be a component or a bare input. */
  const input = ref<{ $el?: HTMLElement } | HTMLInputElement | null>(null)

  /** Focused and selected, so typing replaces rather than appends. */
  async function focus() {
    await nextTick()
    const element = ((input.value as { $el?: HTMLElement })?.$el ??
      input.value) as HTMLInputElement | undefined
    element?.focus?.()
    element?.select?.()
  }

  function start() {
    draft.value = options.value()
    renaming.value = true
    void focus()
  }

  function commit() {
    renaming.value = false
    const next = draft.value.trim()
    // An empty name is a slip rather than an instruction: a row with no name
    // is unfindable, so the old one stands.
    if (next && next !== options.value()) options.onCommit(next)
  }

  function cancel() {
    renaming.value = false
  }

  /**
   * For a row that also offers renaming from a menu.
   *
   * A closing menu takes focus back to the button that opened it, which
   * blurred the field a moment after it appeared — and a blur commits, so
   * the field closed on its own. When the field is what should have focus,
   * the menu hands it over instead of reclaiming it.
   */
  function onMenuClose(event: Event) {
    if (!renaming.value) return
    event.preventDefault()
    void focus()
  }

  return { renaming, draft, input, start, commit, cancel, focus, onMenuClose }
}
