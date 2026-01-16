import { defineStore } from 'pinia'
import { computed } from 'vue'
import { type Hotkey } from '@/types/command.types'
import { CommandName } from '@/stores/command.store'

export enum HotkeyId {
  TOGGLE_NAV_MINI = 'toggle-nav-mini',
  COMMAND_PALETTE = 'command-palette',
  SEARCH = 'search',
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

  // Active bindings tracked by mousetrap key (for unbinding)
  const activeBindings = new Map<string, HotkeyBinding>()

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

    // Track the binding
    activeBindings.set(mousetrapKey, {
      id: id || mousetrapKey,
      mousetrapKey,
      handler,
      hotkey: hotkeyArray,
      name,
      description,
      component,
    })

    return mousetrapKey
  }

  /**
   * Unregister an active binding
   */
  function unregisterBinding(key: string | Hotkey) {
    // Convert to string for mousetrap unbinding
    const mousetrapKey = Array.isArray(key) ? hotkeyArrayToString(key) : key

    const binding = activeBindings.get(mousetrapKey)
    if (binding?.id) {
      unregisterEphemeralHotkey(binding.id)
    }

    activeBindings.delete(mousetrapKey)
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
    return Array.from(activeBindings.values())
  }

  /**
   * Get binding by mousetrap key
   */
  function getBinding(mousetrapKey: string): HotkeyBinding | undefined {
    return activeBindings.get(mousetrapKey)
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
    getHotkeyById,
    getAllEphemeralHotkeys,
    getAllBindings,
    getBinding,
  }
})
