import type { PlaceCategory } from '@/types/place.types'
import { useCategoryPaletteStore } from '@/stores/category-palette.store'
import { getCustomColorTint } from '@/lib/color-tint'

/**
 * Get the category color for the current color scheme.
 * Reads from the server-synced palette (via category-palette.store).
 * Falls back to the built-in fallback palette until data is available.
 */
export function getCategoryColor(category: PlaceCategory | string, isDark: boolean): string {
  const store = useCategoryPaletteStore()
  return store.getCategoryColor(category, isDark)
}

/**
 * The three colours a category's map marker is drawn from.
 *
 * The same trio the basemap's POI badges wear, out of the same function
 * (`getCustomColorTint`, via `map-style/build.ts`) — a search result and the
 * basemap POI underneath it are the same place, and they were reading as two
 * different marks: the badge a tinted plate with a deep glyph, the search pin
 * the raw palette colour with a flat white or near-black glyph on it.
 *
 * Falls back to the untinted colour if it will not parse, which draws a plain
 * disc rather than nothing.
 */
export function getCategoryMarkerTint(
  category: PlaceCategory | string,
  isDark: boolean,
): { plate: string; ink: string; ring: string } {
  const color = getCategoryColor(category, isDark)
  const tint = getCustomColorTint(color, 'solid', isDark)
  const ink = tint?.foreground ?? (isDark ? '#0C0C0C' : '#FFFFFF')
  return {
    plate: tint?.background ?? color,
    ink,
    ring: tint?.ring ?? ink,
  }
}
