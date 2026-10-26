// The navigated route on the map: the leg in its mode colours with the
// travelled part greyed, a bubble naming the road at the next turn, and the
// hazards ahead as signs on the line or bubbles.

import type { GeoJSONSource, Map as MaplibreMap } from 'maplibre-gl'
import type { NavRoute } from '@/lib/guidance/nav-route'
import { drawnLine, drawnOffsetMeters, drawnPoint, drawnProgress, laneOffset, routeGradient, TRAVELLED_CASE_COLOR, TRAVELLED_COLOR } from '@/lib/guidance/route-line'
import type { CalloutSide } from '@/lib/guidance/turn-callout'
import type { ManeuverKind } from '@/lib/directions/maneuver'
import type { RouteHazardKind } from '@/types/directions.types'
import { maneuverIcon, MANEUVER_ICON_STROKE } from '@/lib/directions/maneuver-icon'
import { HAZARD_TONE_COLORS, isHazardSign, SIGN_PASS_METERS, SIGN_TURN_CLEARANCE_METERS, type HazardTone } from '@/lib/guidance/hazard-callouts'
import { hazardIcon, HAZARD_ICON_STROKE } from '@/lib/guidance/hazard-icon'
import { CalloutMarker } from './callout-marker'
import { declutter } from '@/lib/guidance/declutter'
import { ensureHazardSignImages, HAZARD_SIGN_IMAGE } from './hazard-sign-images'
import { slotBeforeId } from '@/lib/map/layer-slots'
import type { RouteSpan } from '@/lib/map-decks/deck.types'
import { getTravelModeCaseColor, getTravelModeColor } from '@/lib/directions/travel-mode-colors'

const ROUTE = 'guidance-route'
/** Read by the 3D bridge decks, which lift the route onto themselves. */
export const GUIDANCE_ROUTE_SOURCE = ROUTE
const HAZARDS = 'guidance-hazards'
const SIGN_MIN_ZOOM = 14
const OVERVIEW_SIGN_MIN_ZOOM = 11
/** Closest two bubbles may sit in the overview before the farther one gives way. */
const BUBBLE_SPACING_PX = 36
/** Radius the route turns through junctions with. */
const CORNER_METERS = 8

type Feature = GeoJSON.Feature<GeoJSON.Geometry>

export interface TurnBubble { at: number; side: CalloutSide; kind: ManeuverKind; text: string; color: string }
export interface HazardBubble { at: number; kind: RouteHazardKind; tone: HazardTone; text: string | null }

export class GuidanceRouteLayer {
  private lastTravelled = -1
  private lastCallout: string | null = null
  private calloutText: string | null = null
  private readonly callout: CalloutMarker
  private readonly hazardMarkers = new Map<string, { marker: CalloutMarker; at: number }>()
  private overview = false
  private turnAt: number | null = null
  private lastHazards = ''
  private lastSignFilter = ''
  private progressAt: ((d: number) => number) | undefined
  /** Where the route is laid over bridge decks, so the flat line leaves those stretches to them. */
  private hidden: RouteSpan[] = []

  constructor(
    private readonly map: MaplibreMap,
    private route: NavRoute,
  ) {
    this.progressAt = route.laneLine ? drawnProgress(route.laneLine) : undefined
    this.callout = new CalloutMarker(map)
    const beforeId = slotBeforeId(map.getStyle().layers, 'middle')
    map.addSource(ROUTE, { type: 'geojson', lineMetrics: true, data: this.routeData() })
    map.addSource(HAZARDS, { type: 'geojson', data: this.hazardData() })
    ensureHazardSignImages(map)
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
        type: 'symbol',
        source: HAZARDS,
        minzoom: SIGN_MIN_ZOOM,
        layout: {
          'icon-image': HAZARD_SIGN_IMAGE as never,
          'icon-size': ['interpolate', ['linear'], ['zoom'], OVERVIEW_SIGN_MIN_ZOOM, 0.5, SIGN_MIN_ZOOM, 0.8, 18, 1.15],
          'symbol-sort-key': ['get', 'at'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-pitch-alignment': 'viewport',
          'icon-anchor': 'bottom',
        },
      },
      slotBeforeId(map.getStyle().layers, 'top'),
    )
    map.on('moveend', this.declutterHazards)
  }

  /** Browsing the route: signs from further out, colliding among themselves, and bubbles thinned on screen. */
  setOverview(overview: boolean): void {
    if (overview === this.overview) return
    this.overview = overview
    this.map.setLayerZoomRange(HAZARDS, overview ? OVERVIEW_SIGN_MIN_ZOOM : SIGN_MIN_ZOOM, 24)
    this.map.setLayoutProperty(HAZARDS, 'icon-allow-overlap', !overview)
    this.map.setLayoutProperty(HAZARDS, 'icon-ignore-placement', !overview)
    if (overview) this.declutterHazards()
    else for (const { marker } of this.hazardMarkers.values()) marker.setVisible(true)
  }

  private readonly declutterHazards = () => {
    if (!this.overview) return
    const entries = [...this.hazardMarkers.values()]
    const project = (at: number) => this.map.project(lngLat(drawnPoint(this.route, at)))
    const turn = this.turnAt == null ? [] : [project(this.turnAt)]
    const kept = declutter([...turn, ...entries.map(({ at }) => project(at))], BUBBLE_SPACING_PX).slice(turn.length)
    entries.forEach(({ marker }, i) => marker.setVisible(kept[i]))
  }

  private hazardData(): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: this.route.hazards.filter(h => isHazardSign(h.kind)).map(h => ({
        type: 'Feature',
        properties: { kind: h.kind, at: h.startDistance },
        geometry: { type: 'Point', coordinates: lngLat(drawnPoint(this.route, h.startDistance)) },
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

  /** `travelled`, and the bubbles for the next turn and hazards at their route distance; cheap to call often. */
  update(travelled: number, callout: TurnBubble | null, hazards: HazardBubble[]): void {
    if (Math.abs(travelled - this.lastTravelled) >= 1) {
      this.lastTravelled = travelled
      this.paint()
    }
    this.turnAt = callout?.at ?? null
    this.filterSigns(travelled, this.turnAt)
    const key = callout && `${callout.at}|${callout.side}|${callout.kind}|${callout.text}|${callout.color}`
    if (key !== this.lastCallout) {
      this.lastCallout = key
      this.calloutText = callout?.text ?? null
      this.callout.show(callout && {
        at: drawnPoint(this.route, callout.at),
        placement: callout.side,
        icon: { ...maneuverIcon(callout.kind), stroke: MANEUVER_ICON_STROKE },
        text: callout.text,
        background: callout.color,
        foreground: '#ffffff',
      })
    }
    this.showHazards(hazards)
  }

  private filterSigns(travelled: number, turnAt: number | null): void {
    const ahead = ['>=', ['get', 'at'], Math.round(travelled + SIGN_PASS_METERS)]
    const filter = turnAt == null ? ahead : ['all', ahead, ['>=', ['abs', ['-', ['get', 'at'], turnAt]], SIGN_TURN_CLEARANCE_METERS]]
    const key = JSON.stringify(filter)
    if (key === this.lastSignFilter) return
    this.lastSignFilter = key
    this.map.setFilter(HAZARDS, filter as never)
  }

  private showHazards(hazards: HazardBubble[]): void {
    const key = JSON.stringify(hazards)
    if (key === this.lastHazards) return
    this.lastHazards = key
    const shown = new Set<string>()
    for (const hazard of hazards) {
      const id = `${hazard.at}|${hazard.kind}`
      shown.add(id)
      let marker = this.hazardMarkers.get(id)?.marker
      if (!marker) this.hazardMarkers.set(id, { marker: (marker = new CalloutMarker(this.map)), at: hazard.at })
      marker.show({
        at: drawnPoint(this.route, hazard.at),
        placement: 'above',
        icon: { d: hazardIcon(hazard.kind), stroke: HAZARD_ICON_STROKE },
        text: hazard.text,
        small: true,
        ...HAZARD_TONE_COLORS[hazard.tone],
      })
    }
    for (const [id, { marker }] of this.hazardMarkers) {
      if (shown.has(id)) continue
      marker.hide()
      this.hazardMarkers.delete(id)
    }
    this.declutterHazards()
  }

  /** The next turn's bubble as drawn on screen. */
  turnCalloutOnScreen(): { box: DOMRect; text: string } | null {
    const box = this.callout.bounds()
    return box && this.calloutText != null ? { box, text: this.calloutText } : null
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
    this.lastSignFilter = ''
    this.showHazards([])
    ;(this.map.getSource(ROUTE) as GeoJSONSource | undefined)?.setData(this.routeData())
    ;(this.map.getSource(HAZARDS) as GeoJSONSource | undefined)?.setData(this.hazardData())
  }

  destroy(): void {
    this.map.off('moveend', this.declutterHazards)
    this.callout.hide()
    this.showHazards([])
    for (const id of [HAZARDS, ROUTE, `${ROUTE}-case`]) {
      if (this.map.getLayer(id)) this.map.removeLayer(id)
    }
    for (const id of [HAZARDS, ROUTE]) {
      if (this.map.getSource(id)) this.map.removeSource(id)
    }
  }
}

const lngLat = (p: { lng: number; lat: number }): [number, number] => [p.lng, p.lat]
