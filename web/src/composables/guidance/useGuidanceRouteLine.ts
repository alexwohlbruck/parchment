import { onScopeDispose, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { useMapStore } from '@/stores/map.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useMapService } from '@/services/map/map.service'
import { GuidanceRouteLayer } from '@/services/guidance/guidance-route-layer'
import { trackDeckLift } from '@/services/guidance/deck-lift.service'
import { travelModeAt } from '@/lib/guidance/guidance-display'
import { distanceAlong, type NavRoute, type NavStep } from '@/lib/guidance/nav-route'
import { bridgeSpans, ridesAt } from '@/lib/guidance/deck-lift'
import { drawnLine, drawnOffsetMeters } from '@/lib/guidance/route-line'
import { turnCallout } from '@/lib/guidance/turn-callout'
import { hazardCallouts, routeHazardCallouts } from '@/lib/guidance/hazard-callouts'
import type { CameraState } from '@/lib/guidance/camera-gesture'
import { getTravelModeCaseColor, getTravelModeColor } from '@/lib/directions/travel-mode-colors'

/** Where along the route the line is drawn from: the travelled part, the next turn, and the hazards ahead. */
export interface RouteLineFocus {
  s: number
  speed: number
  travelled: number
  next: NavStep | null
  hazards: boolean
  /** Browsing the route rather than following: hazards along all of it. */
  overview?: boolean
}

export interface RouteLineSource {
  route: () => NavRoute | null
  focus: () => RouteLineFocus | null
}

export function guidanceRouteSource(cameraState: Ref<CameraState>): RouteLineSource {
  const guidance = useGuidanceStore()
  return {
    route: () => guidance.route,
    focus: () => {
      const progress = guidance.progress
      if (!progress) return null
      const { puck } = progress
      return {
        s: puck.s,
        speed: puck.speed,
        travelled: puck.snapped ? puck.s : 0,
        next: guidance.status === 'away' ? null : progress.next,
        hazards: puck.snapped,
        overview: cameraState.value !== 'following',
      }
    },
  }
}

/** Draws the guided or previewed leg in place of the trip's route lines. */
export function useGuidanceRouteLine(source: RouteLineSource) {
  const { t } = useI18n()
  const mapService = useMapService()
  const strategy = useMapStore().getMapStrategy()
  const map = strategy?.mapInstance as MaplibreMap | undefined
  let layer: GuidanceRouteLayer | null = null
  let stopLift: (() => void) | null = null

  function clear() {
    stopLift?.()
    stopLift = null
    strategy?.setDeckRouteColors(null)
    strategy?.trackDeckRoute(null)
    layer?.destroy()
    layer = null
  }

  const stopRoute = watch(
    source.route,
    route => {
      if (!route) return clear()
      if (!map) return
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
        laid: laid => layer?.setHidden(laid),
      })
    },
    { immediate: true },
  )

  const stopProgress = watch(
    source.focus,
    focus => {
      const route = source.route()
      if (!layer || !focus || !route) return
      layer.setOverview(!!focus.overview)
      const mode = travelModeAt(route, focus.s)
      strategy?.setDeckRouteColors({ route: getTravelModeColor(mode), casing: getTravelModeCaseColor(mode) })
      const callout = calloutFor(route, focus.next)
      layer.update(focus.travelled, callout, focus.hazards ? hazardsFor(route, focus, callout?.at ?? null) : [])
      strategy?.setDeckRouteTravelled(focus.travelled)
    },
    { immediate: true },
  )

  function calloutFor(route: NavRoute, step: NavStep | null) {
    if (!step || step.instruction.type === 'destination') return null
    const { at, side, kind, road } = turnCallout(route, step)
    const text = road.kind === 'named' ? road.name : t(`guidance.roads.${road.key}`)
    return { at, side, kind, text, color: getTravelModeCaseColor(travelModeAt(route, at)) }
  }

  function hazardsFor(route: NavRoute, { s, speed, overview }: RouteLineFocus, turnAt: number | null) {
    const callouts = overview ? routeHazardCallouts(route, s, turnAt) : hazardCallouts(route, s, speed, turnAt)
    return callouts.map(({ hazard, tone, compact }) => ({
      at: hazard.startDistance,
      kind: hazard.kind,
      tone,
      text: compact ? null : t(`guidance.hazards.${hazard.kind}`),
    }))
  }

  onScopeDispose(() => {
    stopRoute()
    stopProgress()
    clear()
  })

  return { turnCalloutOnScreen: () => layer?.turnCalloutOnScreen() ?? null }
}
