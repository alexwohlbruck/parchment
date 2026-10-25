// The navigated route on the map: the leg in its mode colours with the
// travelled part greyed, and a bubble naming the road at the next turn.

import type { GeoJSONSource, Map as MaplibreMap } from 'maplibre-gl'
import type { NavRoute } from '@/lib/guidance/nav-route'
import { drawnLine, drawnOffsetMeters, drawnPoint, drawnProgress, laneOffset, routeGradient, TRAVELLED_CASE_COLOR, TRAVELLED_COLOR } from '@/lib/guidance/route-line'
import type { CalloutSide } from '@/lib/guidance/turn-callout'
import type { ManeuverKind } from '@/lib/directions/maneuver'
import { TurnCalloutMarker } from './turn-callout-marker'
import { slotBeforeId } from '@/lib/map/layer-slots'
import type { RouteSpan } from '@/lib/map-decks/deck.types'
import { getTravelModeCaseColor, getTravelModeColor } from '@/lib/directions/travel-mode-colors'

const ROUTE = 'guidance-route'
/** Read by the 3D bridge decks, which lift the route onto themselves. */
export const GUIDANCE_ROUTE_SOURCE = ROUTE
const HAZARDS = 'guidance-hazards'
/** Radius the route turns through junctions with. */
const CORNER_METERS = 8

type Feature = GeoJSON.Feature<GeoJSON.Geometry>

export class GuidanceRouteLayer {
  private lastTravelled = -1
  private lastCallout: string | null = null
  private readonly callout: TurnCalloutMarker
  private progressAt: ((d: number) => number) | undefined
  /** Where the route is laid over bridge decks, so the flat line leaves those stretches to them. */
  private hidden: RouteSpan[] = []

  constructor(
    private readonly map: MaplibreMap,
    private route: NavRoute,
  ) {
    this.progressAt = route.laneLine ? drawnProgress(route.laneLine) : undefined
    this.callout = new TurnCalloutMarker(map)
    const beforeId = slotBeforeId(map.getStyle().layers, 'middle')
    map.addSource(ROUTE, { type: 'geojson', lineMetrics: true, data: this.routeData() })
    map.addSource(HAZARDS, { type: 'geojson', data: this.hazardData() })
    map.addLayer(
      {
        id: `${ROUTE}-case`,
        type: 'line',
        source: ROUTE,
        layout: { 'line-join': 'round', 'line-cap': 'round', 'line-rounded-corner-distance': CORNER_METERS } as never,
        paint: {
          'line-offset': this.offset() as never,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 6, 18, 22],
          'line-gradient': this.caseGradient(0) as never,
        },
      },
      beforeId,
    )
    map.addLayer(
      {
        id: ROUTE,
        type: 'line',
        source: ROUTE,
        layout: { 'line-join': 'round', 'line-cap': 'round', 'line-rounded-corner-distance': CORNER_METERS } as never,
        paint: {
          'line-offset': this.offset() as never,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 4, 18, 16],
          'line-gradient': this.gradient(0) as never,
        },
      },
      beforeId,
    )
    map.addLayer(
      {
        id: HAZARDS,
        type: 'circle',
        source: HAZARDS,
        minzoom: 14,
        paint: {
          'circle-radius': ['match', ['get', 'severity'], 'high', 6, 'medium', 5, 3.5],
          'circle-color': ['match', ['get', 'severity'], 'high', '#f59e0b', 'medium', '#fbbf24', '#9ca3af'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-pitch-alignment': 'map',
        },
      },
      beforeId,
    )
  }

  private hazardData(): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: this.route.hazards.map(h => ({
        type: 'Feature',
        properties: { severity: h.severity, kind: h.kind, at: h.startDistance },
        geometry: { type: 'Point', coordinates: [h.coordinate.lng, h.coordinate.lat] },
      })),
    }
  }

  private routeData(): Feature {
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: drawnLine(this.route).points.map(p => [p.lng, p.lat]) },
    }
  }

  private gradient(travelled: number) {
    return routeGradient(this.route, travelled, getTravelModeColor, TRAVELLED_COLOR, this.progressAt, this.hidden)
  }

  private caseGradient(travelled: number) {
    return routeGradient(this.route, travelled, getTravelModeCaseColor, TRAVELLED_CASE_COLOR, this.progressAt, this.hidden)
  }

  /** `travelled`, and the bubble for the next turn at its route distance; cheap to call often. */
  update(travelled: number, callout: { at: number; side: CalloutSide; kind: ManeuverKind; text: string; color: string } | null): void {
    if (Math.abs(travelled - this.lastTravelled) >= 1) {
      this.lastTravelled = travelled
      this.paint()
      this.map.setFilter(HAZARDS, ['>=', ['get', 'at'], travelled])
    }
    const key = callout && `${callout.at}|${callout.side}|${callout.kind}|${callout.text}|${callout.color}`
    if (key !== this.lastCallout) {
      this.lastCallout = key
      this.callout.show(callout && { ...callout, at: drawnPoint(this.route, callout.at) })
    }
  }

  /** Leaves the stretches laid over bridge decks to them. */
  setHidden(spans: RouteSpan[]): void {
    const key = (list: RouteSpan[]) => list.map(([a, b]) => `${Math.round(a)}-${Math.round(b)}`).join(',')
    if (key(spans) === key(this.hidden)) return
    this.hidden = spans
    this.paint()
  }

  private paint() {
    const travelled = Math.max(0, this.lastTravelled)
    this.map.setPaintProperty(ROUTE, 'line-gradient', this.gradient(travelled) as never)
    this.map.setPaintProperty(`${ROUTE}-case`, 'line-gradient', this.caseGradient(travelled) as never)
  }

  private offset() {
    return laneOffset(drawnOffsetMeters(this.route), this.route.points[0]?.lat ?? 0)
  }

  setRoute(route: NavRoute): void {
    this.route = route
    this.progressAt = route.laneLine ? drawnProgress(route.laneLine) : undefined
    for (const id of [ROUTE, `${ROUTE}-case`]) if (this.map.getLayer(id)) this.map.setPaintProperty(id, 'line-offset', this.offset() as never)
    this.lastTravelled = -1
    this.hidden = []
    this.lastCallout = null
    ;(this.map.getSource(ROUTE) as GeoJSONSource | undefined)?.setData(this.routeData())
    ;(this.map.getSource(HAZARDS) as GeoJSONSource | undefined)?.setData(this.hazardData())
  }

  destroy(): void {
    this.callout.hide()
    for (const id of [HAZARDS, ROUTE, `${ROUTE}-case`]) {
      if (this.map.getLayer(id)) this.map.removeLayer(id)
    }
    for (const id of [HAZARDS, ROUTE]) {
      if (this.map.getSource(id)) this.map.removeSource(id)
    }
  }
}
