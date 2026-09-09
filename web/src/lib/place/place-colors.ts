import type { PlaceCategory } from '@/types/place.types'
import { useCategoryPaletteStore } from '@/stores/category-palette.store'
import { markerPaint, type MarkerPaint, type MarkerShape } from '@/lib/map-marker'

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
 * The colours a category's map marker is drawn from.
 *
 * The same trio the basemap's POI badges wear, from the same function — a
 * search result and the basemap POI underneath it are the same place, and they
 * were reading as two different marks: the badge a tinted plate with a deep
 * glyph, the search pin the raw palette colour with a flat white or near-black
 * glyph on it.
 *
 * The category lookup is the only part that belongs here; everything about how
 * a marker is coloured lives in `map-marker/marker-paint`.
 */
export function categoryMarkerPaint(
  category: PlaceCategory | string,
  isDark: boolean,
  shape: MarkerShape = 'disc',
): MarkerPaint {
  return markerPaint(getCategoryColor(category, isDark), shape, isDark)
}
