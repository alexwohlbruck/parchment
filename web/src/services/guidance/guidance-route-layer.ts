// The navigated route on the map: the leg in its mode colours with the
// travelled part greyed, and a white arrow through the next maneuver.

import type { GeoJSONSource, Map as MaplibreMap } from 'maplibre-gl'
import type { NavRoute } from '@/lib/guidance/nav-route'
import { laneOffset, maneuverArrow, routeGradient, TRAVELLED_CASE_COLOR, TRAVELLED_COLOR } from '@/lib/guidance/route-line'
import { slotBeforeId } from '@/lib/map/layer-slots'
import { getTravelModeCaseColor, getTravelModeColor } from '@/lib/directions/travel-mode-colors'

const ROUTE = 'guidance-route'
/** Read by the 3D bridge decks, which lift the route onto themselves. */
export const GUIDANCE_ROUTE_SOURCE = ROUTE
const ARROW = 'guidance-maneuver'
const HAZARDS = 'guidance-hazards'
const ARROW_COLOR = '#ffffff'
/** Half a lane: a driven route runs in its lanes, not on the road's centre line. */
const HALF_LANE_METERS = 1.8
/** Radius the route turns through junctions with. */
const CORNER_METERS = 8

type Feature = GeoJSON.Feature<GeoJSON.Geometry>

export class GuidanceRouteLayer {
  private lastTravelled = -1
  private lastManeuver: number | null = null

  constructor(
    private readonly map: MaplibreMap,
    private route: NavRoute,
  ) {
    const beforeId = slotBeforeId(map.getStyle().layers, 'middle')
    map.addSource(ROUTE, { type: 'geojson', lineMetrics: true, data: this.routeData() })
    map.addSource(ARROW, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
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
        id: `${ARROW}-shaft`,
        type: 'line',
        source: ARROW,
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-join': 'round', 'line-cap': 'butt' },
        paint: {
          'line-color': ARROW_COLOR,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 14, 2, 18, 8],
        },
      },
      beforeId,
    )
    map.addLayer(
      {
        id: `${ARROW}-head`,
        type: 'fill',
        source: ARROW,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': ARROW_COLOR },
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
      geometry: { type: 'LineString', coordinates: this.route.points.map(p => [p.lng, p.lat]) },
    }
  }

  private gradient(travelled: number) {
    return routeGradient(this.route, travelled, getTravelModeColor, TRAVELLED_COLOR)
  }

  private caseGradient(travelled: number) {
    return routeGradient(this.route, travelled, getTravelModeCaseColor, TRAVELLED_CASE_COLOR)
  }

  /** `travelled` and the next maneuver's distance along the route; cheap to call often. */
  update(travelled: number, maneuverAt: number | null): void {
    if (Math.abs(travelled - this.lastTravelled) >= 1) {
      this.lastTravelled = travelled
      this.map.setPaintProperty(ROUTE, 'line-gradient', this.gradient(travelled) as never)
      this.map.setPaintProperty(`${ROUTE}-case`, 'line-gradient', this.caseGradient(travelled) as never)
      this.map.setFilter(HAZARDS, ['>=', ['get', 'at'], travelled])
    }
    if (maneuverAt !== this.lastManeuver) {
      this.lastManeuver = maneuverAt
      const features: Feature[] = []
      if (maneuverAt != null) {
        const { shaft, head } = maneuverArrow(this.route, maneuverAt, undefined, undefined, this.offsetMetres())
        features.push(
          { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: shaft.map(p => [p.lng, p.lat]) } },
          { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [head.map(p => [p.lng, p.lat])] } },
        )
      }
      ;(this.map.getSource(ARROW) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features })
    }
  }

  /** Metres right of centre the route is drawn: driving only, as walking and cycling routes keep to paths. */
  private offsetMetres(): number {
    return this.route.segments.length > 0 && this.route.segments.every(s => s.mode === 'driving') ? HALF_LANE_METERS : 0
  }

  private offset() {
    return laneOffset(this.offsetMetres(), this.route.points[0]?.lat ?? 0)
  }

  setRoute(route: NavRoute): void {
    this.route = route
    for (const id of [ROUTE, `${ROUTE}-case`]) if (this.map.getLayer(id)) this.map.setPaintProperty(id, 'line-offset', this.offset() as never)
    this.lastTravelled = -1
    this.lastManeuver = null
    ;(this.map.getSource(ROUTE) as GeoJSONSource | undefined)?.setData(this.routeData())
    ;(this.map.getSource(HAZARDS) as GeoJSONSource | undefined)?.setData(this.hazardData())
  }

  destroy(): void {
    for (const id of [HAZARDS, `${ARROW}-head`, `${ARROW}-shaft`, ROUTE, `${ROUTE}-case`]) {
      if (this.map.getLayer(id)) this.map.removeLayer(id)
    }
    for (const id of [HAZARDS, ARROW, ROUTE]) {
      if (this.map.getSource(id)) this.map.removeSource(id)
    }
  }
}
