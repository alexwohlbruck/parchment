import type { Serializer } from '@vueuse/core'

/**
 * Centralized localStorage key registry.
 * Each key corresponds to a Pinia store or app-level concern.
 */
export const STORAGE_KEYS = {
  // User preferences
  PREFERENCES: 'preferences',

  // App-level config (server, identity)
  APP: 'app',

  // Map state
  MAP: 'map',

  // Layers
  LAYERS: 'layers',

  // Integrations
  INTEGRATIONS: 'integrations',

  // Directions / routing
  DIRECTIONS: 'directions',

  // Notes
  NOTES: 'notes',

  // Theme
  THEME: 'theme',

  // Auth
  USER: 'user',

  // Library
  BOOKMARKS: 'bookmarks',
  COLLECTIONS: 'collections',

  // Locale
  LOCALE: 'locale',

  // Cache keys (managed by useAppDataCache)
  cache: {
    categories: (lang: string) => `cache:categories-${lang}`,
    CATEGORY_PALETTE: 'cache:category-palette',
    NOTES: 'cache:notes',
  },
} as const

/**
 * JSON serializer for useStorage with nullable object/array defaults.
 *
 * vueuse's useStorage infers the serializer from the default value's type.
 * When the default is `null`, it picks the "any" serializer which uses
 * `String(v)` to write — corrupting objects/arrays into "[object Object]".
 * Use this serializer explicitly for any useStorage call whose default is
 * `null` but whose actual values are objects or arrays.
 */
export const jsonSerializer: Serializer<any> = {
  read: (v: string) => {
    try {
      return JSON.parse(v)
    } catch {
      return null
    }
  },
  write: (v: any) => JSON.stringify(v),
}
