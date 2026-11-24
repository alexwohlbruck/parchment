import { computed } from 'vue'
import { useThemeStore } from '@/stores/theme.store'
import { useCategoryPaletteStore } from '@/stores/category-palette.store'
import { poiBadgeColors, type PoiBadgeColors } from '@/lib/map-style/build'

/** Colours a category's badge the way the basemap colours its POIs, in the current theme. */
export function usePoiBadgeColors() {
  const theme = useThemeStore()
  const palette = useCategoryPaletteStore()
  return computed(() => {
    const flavor = theme.isDark ? 'dark' : 'light'
    const colors = palette.categoryColors(theme.isDark)
    return (category: string): PoiBadgeColors => poiBadgeColors(category, flavor, colors)
  })
}
