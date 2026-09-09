import { onMounted, onUnmounted, getCurrentInstance } from 'vue'
import mousetrap from 'mousetrap'
import { type Hotkey } from '@/types/command.types'
import { useHotkeyStore, type AllowInInput } from '@/stores/hotkey.store'

// Re-export for convenience
export type { EphemeralHotkey } from '@/stores/hotkey.store'

interface HotkeyBinding {
  key: string | Hotkey // Accept both string (for mousetrap) or array (compatible with command store)
  handler: () => void
  id?: string
  name?: string // Required if id is provided
  description?: string // Required if id is provided
  // Whether to call event.preventDefault() before invoking the handler.
  // Defaults to true for backwards compatibility, but should be set to
  // false for keys whose default behaviour we want to preserve when our
  // handler is a no-op (e.g. an `esc` binding gated on a v-if'd panel —
  // unconditional preventDefault would swallow Reka UI's dialog close).
  preventDefault?: boolean
  // Whether the key should still fire while a text field has focus. Mousetrap
  // drops those by default, which is right for a single-letter shortcut and
  // wrong for a view-level ⌘Z. Pass a predicate to decide per element.
  allowInInput?: AllowInInput
}

/**
 * Mousetrap decides in one place, for every key, whether a keypress inside a
 * text field counts — so opting one key back in means wrapping that decision
 * rather than setting a flag on the binding. The original still runs for
 * everything that hasn't asked.
 */
// It has to go on the prototype: `Mousetrap.init()` copies forwarding wrappers
// onto the exported object, so assigning there replaces the wrapper and never
// reaches the instance actually listening on the document.
const defaultStopCallback = mousetrap.prototype.stopCallback
mousetrap.prototype.stopCallback = function (
  this: unknown,
  e: KeyboardEvent,
  element: Element,
  combo: string,
  sequence?: string,
) {
  if (useHotkeyStore().allowsInInput(combo, element)) return false
  return defaultStopCallback.call(this, e, element, combo, sequence)
}

/**
 * Get a hotkey array by ID from the store (compatible with command store format)
 */
export function getHotkeyById(id: string): Hotkey | undefined {
  const hotkeyStore = useHotkeyStore()
  return hotkeyStore.getHotkeyById(id)
}

/**
 * Get all ephemeral hotkeys for display in hotkeys menu
 */
export function getAllEphemeralHotkeys() {
  const hotkeyStore = useHotkeyStore()
  return hotkeyStore.getAllEphemeralHotkeys()
}

export function useHotkeys(bindings: HotkeyBinding | HotkeyBinding[]) {
  const hotkeyStore = useHotkeyStore()
  const instance = getCurrentInstance()
  const componentName =
    instance?.type?.name || instance?.type?.__name || 'Unknown'

  onMounted(() => {
    const bindingArray = Array.isArray(bindings) ? bindings : [bindings]

    bindingArray.forEach(
      ({
        key,
        handler,
        id,
        name,
        description,
        preventDefault = true,
        allowInInput,
      }) => {
        // Register binding in the store (handles ephemeral hotkey registration)
        const mousetrapKey = hotkeyStore.registerBinding(
          id,
          key,
          handler,
          name,
          description,
          componentName,
          preventDefault,
          allowInInput,
        )

        // One mousetrap callback per key, dispatching to every component that
        // asked for it. Binding per component looked equivalent but wasn't:
        // mousetrap unbinds a whole key at once, so the first component to
        // unmount took the others' handlers down with it.
        if (hotkeyStore.isBound(mousetrapKey)) return
        mousetrap.bind(mousetrapKey, e => {
          if (hotkeyStore.preventsDefault(mousetrapKey)) e.preventDefault()
          hotkeyStore.dispatch(mousetrapKey)
        })
      },
    )
  })

  onUnmounted(() => {
    const bindingArray = Array.isArray(bindings) ? bindings : [bindings]

    bindingArray.forEach(({ key, handler }) => {
      // Only the last handler for a key may take the key off mousetrap.
      const wasLast = hotkeyStore.unregisterBinding(key, handler)
      if (!wasLast) return

      const mousetrapKey = Array.isArray(key) ? key.join('+') : key
      mousetrap.unbind(mousetrapKey)
    })
  })
}
