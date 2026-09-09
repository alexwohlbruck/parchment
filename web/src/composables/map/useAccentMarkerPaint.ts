import { computed, type ComputedRef } from 'vue'
import { markerPaint, type MarkerPaint, type MarkerShape } from '@/lib/map-marker'
import { getPrimaryThemeHex } from '@/lib/utils'
import { useThemeStore } from '@/stores/theme.store'

/**
 * The app's accent, as marker paint.
 *
 * What a marker for one of the user's own things is drawn in — a tracked
 * vehicle, a friend sharing their location — the way `categoryMarkerPaint` is
 * what a place is drawn in. Neither is a place, so neither takes a category
 * colour, and they should not each invent their own.
 *
 * The accent reaches the page as a CSS variable, so its value has to be read
 * back off the document; the store is only what says it changed.
 */
export function useAccentMarkerPaint(
  shape: MarkerShape = 'disc',
): ComputedRef<MarkerPaint> {
  const themeStore = useThemeStore()

  return computed(() => {
    // A dependency rather than an input: switching accent rewrites the
    // variable `getPrimaryThemeHex` reads, without changing anything passed in.
    void themeStore.accentColor
    return markerPaint(getPrimaryThemeHex(), shape, themeStore.isDark)
  })
}
