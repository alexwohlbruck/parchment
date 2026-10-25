import { onScopeDispose, watch } from 'vue'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { useMapStore } from '@/stores/map.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useMapService } from '@/services/map/map.service'
import { GuidanceRouteLayer } from '@/services/guidance/guidance-route-layer'

/** Draws the navigated leg in place of the trip preview while guidance runs. */
export function useGuidanceRouteLine() {
  const guidance = useGuidanceStore()
  const mapService = useMapService()
  const map = useMapStore().getMapStrategy()?.mapInstance as MaplibreMap | undefined
  let layer: GuidanceRouteLayer | null = null

  const stopRoute = watch(
    () => guidance.route,
    route => {
      if (!map || !route) return
      if (layer) layer.setRoute(route)
      else {
        mapService.setVisibleTrips([])
        layer = new GuidanceRouteLayer(map, route)
      }
    },
    { immediate: true },
  )

  const stopProgress = watch(
    () => guidance.progress,
    progress => {
      if (!layer || !progress) return
      const maneuver = progress.next && progress.next.instruction.type !== 'destination' ? progress.next.startDistance : null
      layer.update(progress.puck.snapped ? progress.puck.s : 0, maneuver)
    },
  )

  onScopeDispose(() => {
    stopRoute()
    stopProgress()
    layer?.destroy()
    layer = null
  })
}
