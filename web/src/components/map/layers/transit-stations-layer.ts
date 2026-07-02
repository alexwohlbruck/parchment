/**
 * Transit Stations Layer
 *
 * Renders Apple-style station labels (station name + a row of coloured route
 * bullets) as HTML DOM markers, NOT baked tile symbols — so they stay
 * screen-space and don't scale/rotate with the map.
 *
 * Data comes from the `transit_stations` vector source via a transparent query
 * layer (`transit-stations-query`, added by the transit layer templates). On
 * every map move we queryRenderedFeatures that layer, dedupe by station, and
 * reconcile the DOM markers (add new, remove out-of-view). Markers only show
 * from MIN_ZOOM so rows don't collide when zoomed out.
 */
import type { Component } from 'vue'
import type { MapMarkerAPI } from './base-marker-layer'
import TransitStationMarker from './TransitStationMarker.vue'

const QUERY_LAYER_ID = 'transit-stations-query'
const ID_PREFIX = 'transit-station-'
const MIN_ZOOM = 13
// Minimum on-screen separation (px) between two LABELLED stations. Roughly the
// footprint of a name + bullet row, so labels don't pile up. (Dots ignore this.)
const MIN_SEP_X = 84
const MIN_SEP_Y = 32
// Cap on total station dots rendered per refresh (biggest interchanges first),
// so a wide low-zoom viewport doesn't spawn thousands of DOM markers.
const MAX_MARKERS = 220

export class TransitStationsLayer {
  private mapAPI: MapMarkerAPI | null = null
  private map: any = null
  private currentIds = new Set<string>()
  // Tracks each rendered marker's showLabel state, so we re-add it when the
  // declutter result flips it between dot-only and labelled.
  private markerLabel = new Map<string, boolean>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private onMove: (() => void) | null = null

  initialize(mapAPI: MapMarkerAPI, map: any) {
    this.mapAPI = mapAPI
    this.map = map

    this.onMove = () => {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => this.refresh(), 250)
    }
    map.on('moveend', this.onMove)
    map.on('zoomend', this.onMove)
    // Also refresh when the map goes idle: after a move to a fresh region the
    // query-layer tiles may not have finished loading by moveend, so
    // queryRenderedFeatures returns nothing. `idle` fires once tiles settle, so
    // this backfills the labels. It's idempotent (reconcile diffs the set).
    map.on('idle', this.onMove)

    // Initial population attempt (tiles may already be loaded).
    this.refresh()
  }

  private queryVisible(): any[] {
    if (!this.map) return []
    try {
      if (!this.map.getLayer?.(QUERY_LAYER_ID)) return []
      if (this.map.getLayoutProperty(QUERY_LAYER_ID, 'visibility') === 'none') {
        return []
      }
      return this.map.queryRenderedFeatures({ layers: [QUERY_LAYER_ID] }) ?? []
    } catch {
      return []
    }
  }

  private refresh() {
    if (!this.map || !this.mapAPI) return
    if (this.map.getZoom() < MIN_ZOOM) {
      this.clear()
      return
    }

    // Dedupe in-view stations by fid; parse routes; project to screen space.
    const seen = new Set<string>()
    const candidates: Array<{
      fid: string
      lngLat: { lng: number; lat: number }
      x: number
      y: number
      name: string
      routes: any[]
      priority: number
    }> = []
    for (const f of this.queryVisible()) {
      const p = f.properties || {}
      const fid = String(p.fid ?? f.id ?? '')
      if (!fid || seen.has(fid)) continue
      const coords = f.geometry?.coordinates
      if (!coords) continue
      seen.add(fid)
      let routes: any[] = []
      try {
        routes = JSON.parse(p.routes || '[]')
      } catch {
        /* ignore malformed */
      }
      const lngLat = { lng: coords[0], lat: coords[1] }
      const pt = this.map.project(lngLat)
      candidates.push({
        fid,
        lngLat,
        x: pt.x,
        y: pt.y,
        name: p.name || '',
        routes,
        priority: Number(p.route_count ?? routes.length ?? 0),
      })
    }

    // Biggest interchanges first (stable ties by fid → no churn).
    candidates.sort((a, b) => b.priority - a.priority || (a.fid < b.fid ? -1 : 1))

    // Greedy screen-space declutter decides which stations get a LABEL
    // (name + bullets); every station still gets a dot.
    const labeled = new Set<string>()
    const placed: typeof candidates = []
    for (const c of candidates) {
      let ok = true
      for (const k of placed) {
        if (Math.abs(c.x - k.x) < MIN_SEP_X && Math.abs(c.y - k.y) < MIN_SEP_Y) {
          ok = false
          break
        }
      }
      if (ok) {
        placed.push(c)
        labeled.add(c.fid)
      }
    }

    // Reconcile: a marker (dot) for every in-view station up to the cap; the
    // decluttered subset also renders its name + bullets. The label sits right
    // of the dot, or below near the right edge. Re-add a marker only when its
    // showLabel flips (else skip to avoid churn).
    const dpr = window.devicePixelRatio || 1
    const widthCss = this.map.getCanvas().width / dpr
    const wanted = new Set<string>()
    for (const c of candidates.slice(0, MAX_MARKERS)) {
      const id = ID_PREFIX + c.fid
      wanted.add(id)
      const showLabel = labeled.has(c.fid)
      const existing = this.currentIds.has(id)
      if (existing && this.markerLabel.get(id) === showLabel) continue
      if (existing) this.mapAPI.removeMarker(id)
      const anchor = c.x > widthCss - 150 ? 'bottom' : 'right'
      this.mapAPI.addVueMarker(
        id,
        c.lngLat,
        TransitStationMarker as Component,
        // lngLat keys the click-through (station detail page); constant per
        // fid, so passing it never invalidates the recycling check above.
        { name: c.name, routes: c.routes, anchor, showLabel, lngLat: c.lngLat },
        showLabel ? 6 : 5,
      )
      this.currentIds.add(id)
      this.markerLabel.set(id, showLabel)
    }
    for (const id of [...this.currentIds]) {
      if (!wanted.has(id)) {
        this.mapAPI.removeMarker(id)
        this.currentIds.delete(id)
        this.markerLabel.delete(id)
      }
    }
  }

  clear() {
    if (!this.mapAPI) return
    for (const id of this.currentIds) this.mapAPI.removeMarker(id)
    this.currentIds.clear()
    this.markerLabel.clear()
  }

  destroy() {
    if (this.map && this.onMove) {
      this.map.off('moveend', this.onMove)
      this.map.off('zoomend', this.onMove)
      this.map.off('idle', this.onMove)
    }
    if (this.timer) clearTimeout(this.timer)
    this.clear()
    this.map = null
    this.mapAPI = null
  }
}
