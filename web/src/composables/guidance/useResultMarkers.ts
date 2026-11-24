import { onScopeDispose, watch, type WatchSource } from 'vue'
import { useMapStore } from '@/stores/map.store'
import { useThemeStore } from '@/stores/theme.store'
import { useCategoryPaletteStore } from '@/stores/category-palette.store'
import { poiBadgeColors } from '@/lib/map-style/build'
import { ResultMarkersLayer } from '@/services/guidance/result-markers-layer'
import type { LngLat } from '@/types/map.types'

export interface ResultPoint {
  location: LngLat
  name: string
  /** Place category, which colours the badge as the basemap colours its POIs. */
  category: string
}

/** Numbers `points` on the map as basemap POIs for as long as the calling scope lives; a tap picks one. */
export function useResultMarkers(points: WatchSource<ResultPoint[]>, onPick: (index: number) => void) {
  const strategy = useMapStore().getMapStrategy()
  const theme = useThemeStore()
  const palette = useCategoryPaletteStore()
  const layer = strategy?.mapInstance ? new ResultMarkersLayer(strategy, onPick) : null

  const stop = watch(
    [points, () => theme.isDark],
    ([list, isDark]) => {
      const flavor = isDark ? 'dark' : 'light'
      const colors = palette.categoryColors(isDark)
      void layer?.setMarkers(list.map(p => ({ location: p.location, name: p.name, colors: poiBadgeColors(p.category, flavor, colors) })))
    },
    { immediate: true },
  )
  onScopeDispose(() => {
    stop()
    layer?.destroy()
  })
}
