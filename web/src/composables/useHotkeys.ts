import { onMounted, onUnmounted, getCurrentInstance } from 'vue'
import mousetrap from 'mousetrap'
import { type Hotkey } from '@/types/command.types'
import { useHotkeyStore } from '@/stores/hotkey.store'

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
      ({ key, handler, id, name, description, preventDefault = true }) => {
        // Register binding in the store (handles ephemeral hotkey registration)
        const mousetrapKey = hotkeyStore.registerBinding(
          id,
          key,
          handler,
          name,
          description,
          componentName,
        )

        // Bind to mousetrap
        mousetrap.bind(mousetrapKey, e => {
          if (preventDefault) e.preventDefault()
          handler()
        })
      },
    )
  })

  onUnmounted(() => {
    const bindingArray = Array.isArray(bindings) ? bindings : [bindings]

    bindingArray.forEach(({ key }) => {
      // Unregister binding from store (handles ephemeral hotkey cleanup)
      hotkeyStore.unregisterBinding(key)

      // Convert to string for mousetrap unbinding
      const mousetrapKey = Array.isArray(key) ? key.join('+') : key

      mousetrap.unbind(mousetrapKey)
    })
  })
}
