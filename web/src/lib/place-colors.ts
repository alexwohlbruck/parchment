import type { PlaceCategory } from '@/types/place.types'
import { useCategoryPaletteStore } from '@/stores/category-palette.store'

/**
 * Get the category color for the current color scheme.
 * Reads from the server-synced palette (via category-palette.store).
 * Falls back to the built-in fallback palette until data is available.
 */
export function getCategoryColor(category: PlaceCategory | string, isDark: boolean): string {
  const store = useCategoryPaletteStore()
  return store.getCategoryColor(category, isDark)
}
