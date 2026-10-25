import type { InjectionKey } from 'vue'

/** Opens the map's bottom sheet to its tallest detent. */
export const EXPAND_MAP_SHEET: InjectionKey<() => void> = Symbol('expand-map-sheet')
