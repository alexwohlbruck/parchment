import { onScopeDispose, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { useMapStore } from '@/stores/map.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useMapService } from '@/services/map/map.service'
import { GuidanceRouteLayer } from '@/services/guidance/guidance-route-layer'
import { trackDeckLift } from '@/services/guidance/deck-lift.service'
import { travelModeAt } from '@/lib/guidance/guidance-display'
import { distanceAlong, type NavStep } from '@/lib/guidance/nav-route'
import { bridgeSpans, ridesAt } from '@/lib/guidance/deck-lift'
import { drawnLine, drawnOffsetMeters } from '@/lib/guidance/route-line'
import { turnCallout } from '@/lib/guidance/turn-callout'
import { getTravelModeCaseColor, getTravelModeColor } from '@/lib/directions/travel-mode-colors'

/** Draws the navigated leg in place of the trip preview while guidance runs. */
export function useGuidanceRouteLine() {
  const guidance = useGuidanceStore()
  const { t } = useI18n()
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
      const spans = bridgeSpans(route)
      strategy?.trackDeckRoute({
        measure: ([lng, lat], from) => distanceAlong(drawnLine(route), { lng, lat }, from),
        offset: drawnOffsetMeters(route),
        rides: s => ridesAt(spans, s),
      })
    },
    { immediate: true },
  )

  const stopProgress = watch(
    () => guidance.progress,
    progress => {
      if (!layer || !progress) return
      const mode = guidance.route ? travelModeAt(guidance.route, progress.puck.s) : 'driving'
      strategy?.setDeckRouteColors({ route: getTravelModeColor(mode), casing: getTravelModeCaseColor(mode) })
      const travelled = progress.puck.snapped ? progress.puck.s : 0
      layer.update(travelled, calloutFor(progress.next))
      strategy?.setDeckRouteTravelled(travelled)
    },
  )

  function calloutFor(step: NavStep | null) {
    const route = guidance.route
    if (!route || !step || step.instruction.type === 'destination') return null
    const { at, side, kind, road } = turnCallout(route, step)
    const text = road.kind === 'named' ? road.name : t(`guidance.roads.${road.key}`)
    return { at, side, kind, text, color: getTravelModeCaseColor(travelModeAt(route, at)) }
  }

  onScopeDispose(() => {
    stopRoute()
    stopProgress()
    stopLift?.()
    strategy?.setDeckRouteColors(null)
    strategy?.trackDeckRoute(null)
    layer?.destroy()
    layer = null
  })
}
