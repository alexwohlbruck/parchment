import { onScopeDispose, watch, type WatchSource } from 'vue'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { useMapStore } from '@/stores/map.store'
import { AheadResultsLayer } from '@/services/guidance/ahead-results-layer'
import type { LngLat } from '@/types/map.types'

/** Numbers `points` on the map for as long as the calling scope lives. */
export function useResultMarkers(points: WatchSource<LngLat[]>) {
  const map = useMapStore().getMapStrategy()?.mapInstance as MaplibreMap | undefined
  const layer = map ? new AheadResultsLayer(map) : null
  const stop = watch(points, list => layer?.setPlaces(list), { immediate: true })
  onScopeDispose(() => {
    stop()
    layer?.destroy()
  })
}
