import { onScopeDispose, watch } from 'vue'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { useMapStore } from '@/stores/map.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useMapService } from '@/services/map/map.service'
import { GuidanceRouteLayer } from '@/services/guidance/guidance-route-layer'
import { trackDeckLift } from '@/services/guidance/deck-lift.service'
import { travelModeAt } from '@/lib/guidance/guidance-display'
import { distanceAlong } from '@/lib/guidance/nav-route'
import { getTravelModeCaseColor, getTravelModeColor } from '@/lib/directions/travel-mode-colors'

/** Draws the navigated leg in place of the trip preview while guidance runs. */
export function useGuidanceRouteLine() {
  const guidance = useGuidanceStore()
  const mapService = useMapService()
  const strategy = useMapStore().getMapStrategy()
  const map = strategy?.mapInstance as MaplibreMap | undefined
  let layer: GuidanceRouteLayer | null = null
  let stopLift: (() => void) | null = null

  const stopRoute = watch(
    () => guidance.route,
    route => {
      if (!map || !route) return
      if (layer) layer.setRoute(route)
      else {
        mapService.setVisibleTrips([])
        layer = new GuidanceRouteLayer(map, route)
      }
      stopLift?.()
      stopLift = strategy ? trackDeckLift(strategy, route) : null
      strategy?.measureDeckRoute(([lng, lat], from) => distanceAlong(route.laneLine ?? route, { lng, lat }, from))
    },
    { immediate: true },
  )

  const stopProgress = watch(
    () => guidance.progress,
    progress => {
      if (!layer || !progress) return
      const mode = guidance.route ? travelModeAt(guidance.route, progress.puck.s) : 'driving'
      strategy?.setDeckRouteColors({ route: getTravelModeColor(mode), casing: getTravelModeCaseColor(mode) })
      const maneuver = progress.next && progress.next.instruction.type !== 'destination' ? progress.next.startDistance : null
      const travelled = progress.puck.snapped ? progress.puck.s : 0
      layer.update(travelled, maneuver)
      strategy?.setDeckRouteTravelled(travelled)
    },
  )

  onScopeDispose(() => {
    stopRoute()
    stopProgress()
    stopLift?.()
    strategy?.setDeckRouteColors(null)
    strategy?.measureDeckRoute(null)
    layer?.destroy()
    layer = null
  })
}
