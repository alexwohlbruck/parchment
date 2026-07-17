/**
 * Route builder map layers.
 *
 * Two concerns, both driven reactively by the route-builder store and inert
 * until a build session is active:
 *
 *   - RouteBuilderLayer — draggable numbered waypoint markers (extends the
 *     standard BaseMarkerLayer; rendered via the shared marker API).
 *   - RouteBuilderLineLayer — the snapped path drawn as a cased GeoJSON line
 *     straight on the maplibre instance (same approach as the pegman/route
 *     previews in the strategy).
 */

import { watch, type WatchStopHandle } from 'vue'
import { BaseMarkerLayer, type MarkerData } from './base-marker-layer'
import { useRouteBuilderStore } from '@/stores/route-builder.store'
import { useRouteBuilderService } from '@/services/route-builder.service'
import { getTravelModeColor, getTravelModeCaseColor } from '@/lib/travel-mode-colors'
import type { MapStrategy } from '../map-providers/map.strategy'
import RouteBuilderWaypointMarker from '@/components/map/RouteBuilderWaypointMarker.vue'
import RouteBuilderTurnaroundMarker from '@/components/map/RouteBuilderTurnaroundMarker.vue'

export class RouteBuilderLayer extends BaseMarkerLayer {
  private store = useRouteBuilderStore()
  private builder = useRouteBuilderService()

  constructor() {
    super({
      idPrefix: 'route-builder-wp-',
      component: RouteBuilderWaypointMarker,
      zIndex: 4, // above directions waypoints while building
    })
  }

  protected getData(): MarkerData[] {
    if (!this.store.isActive) return []
    const wps = this.store.waypoints
    const readOnly = this.store.readOnly
    const last = wps.length - 1
    const isLoop = this.store.isClosedLoop
    // Turnaround apexes render as a draggable U-turn badge (separate layer)
    // instead of a numbered handle, so skip those indices here.
    const turnIndices = new Set(this.store.turnarounds.map((t) => t.index))

    const out: MarkerData[] = []
    wps.forEach((wp, index) => {
      if (turnIndices.has(index)) return
      // On a closed loop, dragging an endpoint should visibly drag both
      // coincident anchors. Live-move the paired marker during the drag;
      // the store keeps them in sync on drop (moveWaypoint).
      const loopEndpoint = isLoop && (index === 0 || index === last)
      const pairedId = loopEndpoint
        ? `${this.idPrefix}${index === 0 ? last : 0}`
        : null
      out.push({
        id: String(index),
        lngLat: { lng: wp.lng, lat: wp.lat } as any,
        props: {
          index,
          total: wps.length,
          type: index === 0 ? 'start' : index === last ? 'end' : 'mid',
        },
        // No drag handles in read-only preview (detail view).
        ...(readOnly
          ? {}
          : {
              dragOptions: {
                onDrag: (lngLat) => {
                  if (pairedId) this.mapAPI?.setMarkerLngLat(pairedId, lngLat)
                },
                onDragEnd: (lngLat) =>
                  this.builder.moveWaypointTo(index, lngLat),
              },
            }),
      })
    })
    return out
  }
}

/**
 * Turnaround badges at points where the route reverses direction (out-&-back
 * apexes). The badge replaces the numbered handle there and is itself
 * draggable so the apex can still be moved.
 */
export class RouteBuilderTurnaroundLayer extends BaseMarkerLayer {
  private store = useRouteBuilderStore()
  private builder = useRouteBuilderService()

  constructor() {
    super({
      idPrefix: 'route-builder-turn-',
      component: RouteBuilderTurnaroundMarker,
      zIndex: 4,
    })
  }

  protected getData(): MarkerData[] {
    if (!this.store.isActive) return []
    const readOnly = this.store.readOnly
    return this.store.turnarounds.map((t) => ({
      id: String(t.index),
      lngLat: { lng: t.lng, lat: t.lat } as any,
      props: {},
      ...(readOnly
        ? {}
        : {
            dragOptions: {
              onDragEnd: (lngLat) => this.builder.moveWaypointTo(t.index, lngLat),
            },
          }),
    }))
  }
}

const SOURCE_ID = 'route-builder-line'
const SYMBOL_SOURCE_ID = 'route-builder-symbols'
const CASE_LAYER_ID = 'route-builder-line-case'
const LINE_LAYER_ID = 'route-builder-line-main'
const ONEWAY_LAYER_ID = 'route-builder-line-oneway'
const BIDIR_LAYER_ID = 'route-builder-line-bidir'
const CHEVRON_IMAGE_ID = 'route-builder-chevron'
const BIDIR_IMAGE_ID = 'route-builder-bidir'

// Lucide icon geometry (24×24 viewBox), so the map symbols match the rest of
// the UI. `chevron-right` for one-way travel direction; `move-horizontal`
// (a two-headed arrow) for retraced out-&-back legs, drawn once per shared
// edge so opposing arrows never cross.
const LUCIDE_CHEVRON_RIGHT = ['M9 18 L15 12 L9 6']
const LUCIDE_MOVE_HORIZONTAL = [
  'M2 12 L22 12',
  'M18 8 L22 12 L18 16',
  'M6 8 L2 12 L6 16',
]

/**
 * Rasterize a lucide-style icon (array of SVG path `d` strings on a 24-unit
 * viewBox) to a white map image with a soft dark halo for contrast. Added
 * once per map instance.
 */
function ensureLucideImage(map: any, id: string, paths: string[]) {
  if (!map || typeof map.hasImage !== 'function' || map.hasImage(id)) return
  const r = 2 // retina
  const size = 22 // rendered px (the 24-unit viewBox is scaled to fit)
  const canvas = document.createElement('canvas')
  canvas.width = size * r
  canvas.height = size * r
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale((size * r) / 24, (size * r) / 24)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const pass of ['halo', 'fill'] as const) {
    ctx.strokeStyle = pass === 'halo' ? 'rgba(0,0,0,0.3)' : '#ffffff'
    ctx.lineWidth = pass === 'halo' ? 4 : 2.5
    for (const d of paths) ctx.stroke(new Path2D(d))
  }
  const data = ctx.getImageData(0, 0, size * r, size * r)
  map.addImage(id, data, { pixelRatio: r })
}

/** Canonical key for an undirected edge between two waypoints. */
function edgeKey(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): string {
  const ka = `${a.lat.toFixed(5)},${a.lng.toFixed(5)}`
  const kb = `${b.lat.toFixed(5)},${b.lng.toFixed(5)}`
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
}

/** Draws + updates the snapped path line for the builder. */
export class RouteBuilderLineLayer {
  private store = useRouteBuilderStore()
  private map: MapStrategy
  private watchStop: WatchStopHandle | null = null
  private built = false

  constructor(map: MapStrategy) {
    this.map = map
  }

  initialize() {
    this.watchStop = watch(
      () => ({
        active: this.store.isActive,
        mode: this.store.mode,
        geometry: this.store.geometry,
      }),
      (s) => {
        if (!s.active || s.geometry.length < 2) {
          this.teardown()
          return
        }
        this.render(s.geometry, s.mode)
      },
      { deep: true, immediate: true },
    )
  }

  private geojson(geometry: Array<[number, number]>) {
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: geometry },
    }
  }

  private render(geometry: Array<[number, number]>, mode: string) {
    const m = this.map.mapInstance
    if (!m || !m.isStyleLoaded?.()) return
    const data = this.geojson(geometry)
    const existing = m.getSource(SOURCE_ID)
    if (existing) {
      existing.setData(data)
    } else {
      m.addSource(SOURCE_ID, { type: 'geojson', data })
    }

    const color = getTravelModeColor(mode)
    const caseColor = getTravelModeCaseColor(mode)

    if (!m.getLayer(CASE_LAYER_ID)) {
      m.addLayer({
        id: CASE_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': caseColor, 'line-width': 8 },
      })
    } else {
      m.setPaintProperty(CASE_LAYER_ID, 'line-color', caseColor)
    }
    if (!m.getLayer(LINE_LAYER_ID)) {
      m.addLayer({
        id: LINE_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': color, 'line-width': 5 },
      })
    } else {
      m.setPaintProperty(LINE_LAYER_ID, 'line-color', color)
    }

    // Direction symbols: one-way legs get travel-direction chevrons;
    // retraced (out-&-back) legs get a single two-headed arrow so opposing
    // chevrons never cross. Built from per-leg geometry on a second source.
    ensureLucideImage(m, CHEVRON_IMAGE_ID, LUCIDE_CHEVRON_RIGHT)
    ensureLucideImage(m, BIDIR_IMAGE_ID, LUCIDE_MOVE_HORIZONTAL)

    const symbolData = this.buildSymbolFeatures(geometry)
    const symbolSource = m.getSource(SYMBOL_SOURCE_ID)
    if (symbolSource) {
      symbolSource.setData(symbolData)
    } else {
      m.addSource(SYMBOL_SOURCE_ID, { type: 'geojson', data: symbolData })
    }

    const common = {
      'symbol-placement': 'line' as const,
      'symbol-spacing': 85,
      'icon-size': 1,
      'icon-rotation-alignment': 'map' as const,
      'icon-keep-upright': false,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    }
    if (m.hasImage(CHEVRON_IMAGE_ID) && !m.getLayer(ONEWAY_LAYER_ID)) {
      m.addLayer({
        id: ONEWAY_LAYER_ID,
        type: 'symbol',
        source: SYMBOL_SOURCE_ID,
        filter: ['==', ['get', 'bidir'], false],
        layout: { ...common, 'icon-image': CHEVRON_IMAGE_ID },
      })
    }
    if (m.hasImage(BIDIR_IMAGE_ID) && !m.getLayer(BIDIR_LAYER_ID)) {
      m.addLayer({
        id: BIDIR_LAYER_ID,
        type: 'symbol',
        source: SYMBOL_SOURCE_ID,
        filter: ['==', ['get', 'bidir'], true],
        layout: { ...common, 'icon-image': BIDIR_IMAGE_ID },
      })
    }
    this.built = true
  }

  /**
   * Per-leg LineString features tagged `bidir`. A leg is bidirectional when
   * the same undirected edge appears more than once in the route (the route
   * retraces it) — emitted once so a single two-headed arrow stands in for
   * the two opposing one-way chevrons. Falls back to a single one-way feature
   * over the whole path when per-leg segments aren't available.
   */
  private buildSymbolFeatures(geometry: Array<[number, number]>) {
    const wps = this.store.waypoints
    const segs = this.store.segments
    const features: Array<{
      type: 'Feature'
      properties: { bidir: boolean }
      geometry: { type: 'LineString'; coordinates: Array<[number, number]> }
    }> = []

    if (segs.length > 0 && segs.length === wps.length - 1) {
      const keys = segs.map((_s, i) => edgeKey(wps[i], wps[i + 1]))
      const count: Record<string, number> = {}
      for (const k of keys) count[k] = (count[k] ?? 0) + 1
      const seen = new Set<string>()
      segs.forEach((seg, i) => {
        const bidir = count[keys[i]] > 1
        if (bidir) {
          if (seen.has(keys[i])) return // emit each shared edge only once
          seen.add(keys[i])
        }
        features.push({
          type: 'Feature',
          properties: { bidir },
          geometry: { type: 'LineString', coordinates: seg.geometry },
        })
      })
    } else {
      features.push({
        type: 'Feature',
        properties: { bidir: false },
        geometry: { type: 'LineString', coordinates: geometry },
      })
    }

    return { type: 'FeatureCollection' as const, features }
  }

  private teardown() {
    if (!this.built) return
    const m = this.map.mapInstance
    try {
      if (m.getLayer(ONEWAY_LAYER_ID)) m.removeLayer(ONEWAY_LAYER_ID)
      if (m.getLayer(BIDIR_LAYER_ID)) m.removeLayer(BIDIR_LAYER_ID)
      if (m.getLayer(LINE_LAYER_ID)) m.removeLayer(LINE_LAYER_ID)
      if (m.getLayer(CASE_LAYER_ID)) m.removeLayer(CASE_LAYER_ID)
      if (m.getSource(SYMBOL_SOURCE_ID)) m.removeSource(SYMBOL_SOURCE_ID)
      if (m.getSource(SOURCE_ID)) m.removeSource(SOURCE_ID)
    } catch {
      // style may already be gone (theme change) — safe to ignore
    }
    this.built = false
  }

  destroy() {
    this.watchStop?.()
    this.watchStop = null
    this.teardown()
  }
}
