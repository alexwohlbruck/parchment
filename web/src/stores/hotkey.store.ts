import { defineStore } from 'pinia'
import { computed } from 'vue'
import { type Hotkey } from '@/types/command.types'
import { CommandName } from '@/stores/command.store'

export enum HotkeyId {
  TOGGLE_NAV_MINI = 'toggle-nav-mini',
  COMMAND_PALETTE = 'command-palette',
  SEARCH = 'search',
  OPEN_SETTINGS = 'open-settings',
}

export interface EphemeralHotkey {
  id: string
  name: string
  description: string
  hotkey: Hotkey
  component?: string // Optional: track which component registered it
  registeredAt: number // Timestamp of registration
}

interface HotkeyBinding {
  id: string
  mousetrapKey: string // The key string used for mousetrap binding
  handler: () => void
  preventDefault?: boolean
  hotkey: Hotkey // The array format hotkey
  name?: string
  description?: string
  component?: string
}

/**
 * Convert hotkey array to mousetrap string format
 * e.g., ["meta", "s"] -> "meta+s"
 */
function hotkeyArrayToString(hotkey: Hotkey): string {
  return hotkey.join('+')
}

/**
 * Convert hotkey string to array format (compatible with command store)
 * e.g., "meta+s" -> ["meta", "s"]
 */
function hotkeyStringToArray(key: string): Hotkey {
  return key.split('+').map(k => k.trim())
}

export const useHotkeyStore = defineStore('hotkey', () => {
  // Registry of all ephemeral hotkeys with metadata
  const ephemeralHotkeys = new Map<string, EphemeralHotkey>()

  /**
   * Active bindings, several per key.
   *
   * More than one component binds the same key at once — `esc` is bound by
   * the left sheet, the bottom sheet and whatever view is open — and
   * mousetrap's own unbind is per key, not per callback, so letting each
   * component bind and unbind directly meant the first one to unmount took
   * everyone else's handler with it. Keeping the list here means a component
   * going away only removes its own.
   */
  const activeBindings = new Map<string, HotkeyBinding[]>()

  /**
   * Register an ephemeral hotkey
   */
  function registerEphemeralHotkey(
    id: string,
    hotkey: Hotkey,
    name: string,
    description: string,
    component?: string,
  ) {
    if (!name || !description) {
      console.warn(
        `useHotkeys: Hotkey binding with id "${id}" requires both name and description`,
      )
      return
    }

    ephemeralHotkeys.set(id, {
      id,
      name,
      description,
      hotkey,
      component,
      registeredAt: Date.now(),
    })
  }

  /**
   * Unregister an ephemeral hotkey
   */
  function unregisterEphemeralHotkey(id: string) {
    ephemeralHotkeys.delete(id)
  }

  /**
   * Register an active binding (for mousetrap)
   */
  function registerBinding(
    id: string | undefined,
    key: string | Hotkey,
    handler: () => void,
    name?: string,
    description?: string,
    component?: string,
    preventDefault?: boolean,
  ): string {
    // Convert to array format for storage
    const hotkeyArray: Hotkey = Array.isArray(key)
      ? key
      : hotkeyStringToArray(key)

    // Convert to string for mousetrap binding
    const mousetrapKey = Array.isArray(key) ? hotkeyArrayToString(key) : key

    // Register ephemeral hotkey if ID is provided
    if (id && name && description) {
      registerEphemeralHotkey(id, hotkeyArray, name, description, component)
    }

    // Newest first: the view opened most recently is the one that should get
    // a key before the chrome it opened over.
    activeBindings.set(mousetrapKey, [
      {
        id: id || mousetrapKey,
        mousetrapKey,
        handler,
        preventDefault,
        hotkey: hotkeyArray,
        name,
        description,
        component,
      },
      ...(activeBindings.get(mousetrapKey) ?? []),
    ])

    return mousetrapKey
  }

  /** Whether this key already has a mousetrap callback dispatching to it. */
  function isBound(mousetrapKey: string) {
    return (activeBindings.get(mousetrapKey)?.length ?? 0) > 1
  }

  /** Run every handler registered for a key, newest first. */
  function dispatch(mousetrapKey: string) {
    for (const binding of [...(activeBindings.get(mousetrapKey) ?? [])]) {
      binding.handler()
    }
  }

  /** Whether any handler for this key wants the browser default suppressed. */
  function preventsDefault(mousetrapKey: string) {
    return (activeBindings.get(mousetrapKey) ?? []).some(
      binding => binding.preventDefault !== false,
    )
  }

  /**
   * Unregister an active binding
   */
  /**
   * Drop one component's binding for a key. Returns whether the key has no
   * handlers left, which is the only point at which mousetrap should be
   * unbound — its unbind takes the whole key with it.
   */
  function unregisterBinding(
    key: string | Hotkey,
    handler?: () => void,
  ): boolean {
    const mousetrapKey = Array.isArray(key) ? hotkeyArrayToString(key) : key
    const bindings = activeBindings.get(mousetrapKey) ?? []

    const remaining = handler
      ? bindings.filter(binding => binding.handler !== handler)
      : bindings.slice(1)
    const removed = bindings.filter(binding => !remaining.includes(binding))

    for (const binding of removed) {
      if (binding.id) unregisterEphemeralHotkey(binding.id)
    }

    if (remaining.length) activeBindings.set(mousetrapKey, remaining)
    else activeBindings.delete(mousetrapKey)
    return remaining.length === 0
  }

  /**
   * Get a hotkey array by ID from the registry
   */
  function getHotkeyById(id: string): Hotkey | undefined {
    return ephemeralHotkeys.get(id)?.hotkey
  }

  /**
   * Get all ephemeral hotkeys for display
   */
  function getAllEphemeralHotkeys(): EphemeralHotkey[] {
    return Array.from(ephemeralHotkeys.values())
  }

  /**
   * Get all active bindings (for debugging/inspection)
   */
  function getAllBindings(): HotkeyBinding[] {
    return Array.from(activeBindings.values()).flat()
  }

  /**
   * Get the binding that would run first for a key — the most recently
   * registered, since that is the view closest to the user.
   */
  function getBinding(mousetrapKey: string): HotkeyBinding | undefined {
    return activeBindings.get(mousetrapKey)?.[0]
  }

  // Computed getters for reactive access
  const ephemeralHotkeysList = computed(() =>
    Array.from(ephemeralHotkeys.values()),
  )
  const activeBindingsList = computed(() => Array.from(activeBindings.values()))

  return {
    // Computed state (reactive)
    ephemeralHotkeysList,
    activeBindingsList,

    // Actions
    registerEphemeralHotkey,
    unregisterEphemeralHotkey,
    registerBinding,
    unregisterBinding,
    isBound,
    dispatch,
    preventsDefault,
    getHotkeyById,
    getAllEphemeralHotkeys,
    getAllBindings,
    getBinding,
  }
})
