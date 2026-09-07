/**
 * Route Isolation Service
 *
 * When a route detail is active, this service:
 *   1. Dims the rest of the transit network (it stays on the map)
 *   2. Adds a highlighted route shape to the map (bold, route-colored)
 *   3. Adds station markers along the route
 *   4. Cleans up when the route is deactivated
 *
 * Designed to work with any MapStrategy that has a mapInstance (Mapbox/MapLibre).
 */

import { watch, type WatchStopHandle } from 'vue'
import { useRouteDetailStore, type RouteDetailStop } from '@/stores/route-detail.store'
import { densifyLine } from '@/lib/geo-densify'
import { projectAlong, sliceAlong } from '@/lib/geo-line'
import { widthExpr } from '@/services/layers/features/portolan/portolan-expressions'
import { usePortolanTransitService } from '@/services/layers/features/portolan/portolan-transit.service'
import type { FitBoundsFn } from '@/types/map.types'

const ROUTE_SOURCE_ID = 'route-detail-shape'
const ROUTE_LAYER_ID = 'route-detail-line'
const STOPS_SOURCE_ID = 'route-detail-stops'
const STOPS_LAYER_ID = 'route-detail-stops-circles'
const STOPS_LABELS_LAYER_ID = 'route-detail-stops-labels'

/** Transitland layer IDs that should be faded when isolating (retired from
 *  the default template — kept for user-cloned copies still on the map).
 *  Excludes `transitland-route-active` — it's a hover utility layer with
 *  a feature-state opacity expression that breaks if overridden flat.
 *  Portolan layers are NOT listed: they're enumerated live off the style
 *  by their `portolan-` prefix, since the set (per-feed, per-band) is
 *  dynamic. */
const TRANSIT_LAYER_IDS = [
  'transitland-rail',
  'transitland-rail-outline',
  'transitland-bus-low',
  'transitland-bus-low-outline',
  'transitland-bus-medium',
  'transitland-bus-medium-outline',
  'transitland-tram',
  'transitland-tram-outline',
  'transitland-metro',
  'transitland-metro-outline',
  'transitland-other',
  'transitland-other-outline',
  'transitland-tram-labels',
  'transitland-metro-labels',
  'transitland-rail-labels',
  'transitland-bus-medium-labels',
  'transitland-other-labels',
  'transitland-stops',
  'transitland-stops-labels',
]

/** How far the rest of the network steps back while a route is isolated —
 *  dimmed, not hidden, so the line still reads inside its network. Matches
 *  portolan's own ISOLATION_DIM — keep the two in step. */
const NETWORK_DIM_LIGHT = 0.25
const NETWORK_DIM_DARK = 0.42
/** Theme-dependent for the same reason portolan's is: the same alpha reads
 *  as "gone" against a near-black basemap. */
const NETWORK_DIM = () =>
  document.documentElement.classList.contains('dark')
    ? NETWORK_DIM_DARK
    : NETWORK_DIM_LIGHT

/** Which opacity paint props carry a layer type's fade. */
const OPACITY_PROPS: Record<string, string[]> = {
  line: ['line-opacity'],
  circle: ['circle-opacity', 'circle-stroke-opacity'],
  symbol: ['text-opacity', 'icon-opacity'],
}

export function useRouteIsolationService() {
  const routeDetailStore = useRouteDetailStore()
  const portolan = usePortolanTransitService()
  let mapInstance: any = null
  let fitBoundsFn: FitBoundsFn | null = null
  let watchStop: WatchStopHandle | null = null
  let stopsWatchStop: WatchStopHandle | null = null
  let isIsolated = false
  /** True while portolan's own layers are carrying the isolation, so the
   *  teardown knows to widen them again rather than un-fade them. */
  let portolanIsolated = false
  /** Bumps on every isolate/restore, so a deferred confirmation that
   *  belongs to a route the rider has already navigated away from does
   *  nothing at all. */
  let isolationGeneration = 0
  /** The idle-driven reconciler for the current isolation, so teardown can
   *  unhook it. */
  let reconciler: (() => void) | null = null

  function initialize(map: any, fitBounds?: FitBoundsFn) {
    mapInstance = map
    fitBoundsFn = fitBounds ?? null

    watchStop = watch(
      () => routeDetailStore.activeRoute,
      (route) => {
        if (route) {
          applyIsolation(route)
        } else {
          removeIsolation()
        }
      },
      { immediate: true },
    )

    // The running path, pushed as it settles (boards answering, alerts
    // landing) so the map's stations track the panel's timeline. Portolan
    // holds it and applies it only while a route is isolated — and when the
    // path turns out to end short of the line, the whole render is redone,
    // because which renderer draws the line depends on it.
    stopsWatchStop = watch(
      () => routeDetailStore.servedStops,
      (stops) => {
        portolan.setIsolatedRouteStops(
          stops.length ? stops.map(s => [s.lng, s.lat] as [number, number]) : null,
        )
        const route = routeDetailStore.activeRoute
        if (isIsolated && route) render(route, isolationGeneration)
      },
      { immediate: true },
    )
  }

  /**
   * Isolate by LIFTING the route out of portolan rather than drawing over
   * it.
   *
   * Where portolan draws the route, its own ribbons already have the
   * geometry, the colour, the stations and the labels — and, uniquely,
   * the hours: a per-route mask on every segment, which is the only thing
   * on this map that knows the 5 runs a fraction of its route at night or
   * that the B stops running at all. So the route keeps full strength
   * exactly where it runs at this hour, and the rest of the network dims
   * behind it instead of disappearing: a line is followed through a city,
   * and the ribbons it crosses are what make the next transfer visible.
   *
   * Where portolan does not draw it — a bus in a city with no pyramid —
   * the shape-and-circles view is still the only view there is.
   */
  /**
   * Tear down the shape-and-circles overlay.
   *
   * It and portolan's ribbon are two renderings of the same line, and they
   * can never agree on screen: portolan draws bundled routes at parallel
   * slot offsets (`line-offset`), so its ribbon sits beside the centreline
   * this overlay is drawn on, with its own station dots and labels beside
   * ours. Only one of them may be on the map at a time.
   */
  function removeRouteOverlay() {
    removeLayerIfExists(STOPS_LABELS_LAYER_ID)
    removeLayerIfExists(STOPS_LAYER_ID)
    removeSourceIfExists(STOPS_SOURCE_ID)
    removeLayerIfExists(ROUTE_LAYER_ID)
    removeSourceIfExists(ROUTE_SOURCE_ID)
  }

  type IsolatableRoute = {
    routeId?: string
    routeColor: string | null
    coordinates: [number, number][] | null
    stops: RouteDetailStop[]
  }

  /** Signature of the last render, so the served-stops watcher can re-ask
   *  for the same picture repeatedly without redrawing it. */
  let renderedSig = ''

  /**
   * The route's shape cut down to the span between the running path's two
   * end stops, or null when there is nothing to cut with. The ends are
   * found by the stops' own distance-along metric, then projected onto the
   * shape so cut and stop land in the same place; a path spanning the full
   * shape slices to the whole thing, which is what a mere branch-break
   * (canonical shape already right, ribbon wrong) needs.
   */
  function runningSlice(route: IsolatableRoute): [number, number][] | null {
    const coords = route.coordinates
    if (!coords || coords.length < 2) return null
    const served = routeDetailStore.servedStops
    if (served.length < 2) return null
    let lo = served[0]
    let hi = served[0]
    for (const s of served) {
      if (s.distanceAlongRoute < lo.distanceAlongRoute) lo = s
      if (s.distanceAlongRoute > hi.distanceAlongRoute) hi = s
    }
    const a = projectAlong(coords, [lo.lng, lo.lat])
    const b = projectAlong(coords, [hi.lng, hi.lat])
    const sliced = sliceAlong(coords, Math.min(a, b), Math.max(a, b))
    return sliced.length >= 2 ? sliced : null
  }

  function applyIsolation(route: IsolatableRoute) {
    if (!mapInstance) return

    // A previous pass may have left the overlay or its reconciler up —
    // switching direction or reopening re-runs this, and portolan may answer
    // differently the second time now that its tiles have arrived.
    detachReconciler()
    removeRouteOverlay()

    // Fit map to route bounds
    fitToRoute(route)

    const generation = ++isolationGeneration
    isIsolated = true
    renderedSig = ''
    render(route, generation)
  }

  /**
   * Draw the isolated route from what is knowable right now. Re-entrant:
   * the served-stops watcher re-runs it as the boards and alerts land,
   * because their answer can change WHICH renderer draws the line.
   */
  function render(route: IsolatableRoute, generation: number) {
    if (!mapInstance || generation !== isolationGeneration) return
    const broken = routeDetailStore.pathLeavesTrack
    const sig =
      (broken ? 'break' : 'full') +
      '|' + routeDetailStore.servedStops.map(s => s.stopId).join(',')
    if (sig === renderedSig) return
    renderedSig = sig
    detachReconciler()

    /** Portolan draws the route: dim everything else and stand the overlay
     *  down. Idempotent — the reconciler may land here repeatedly. */
    const renderViaPortolan = (token: string) => {
      portolan.setIsolatedRoute(token)
      if (!portolanIsolated) {
        portolanIsolated = true
        // re-derive: the overlay pass faded portolan's layers flat
        fadeTransitLayers(null)
        fadeTransitLayers(NETWORK_DIM(), { skipPortolan: true })
      }
      removeRouteOverlay()
    }

    /** No pyramid draws this route: the shape-and-circles overlay is the
     *  only view there is. It too draws the running span, not the full
     *  timetable line. */
    const renderViaOverlay = () => {
      if (portolanIsolated) {
        portolan.setIsolatedRoute(null)
        portolanIsolated = false
        fadeTransitLayers(null)
      }
      fadeTransitLayers(NETWORK_DIM())
      const coords = runningSlice(route) ?? route.coordinates
      if (coords && coords.length >= 2) {
        addRouteShape(coords, route.routeColor)
      }
      const stops = routeDetailStore.servedStops.length
        ? routeDetailStore.servedStops
        : route.stops
      if (stops.length > 0) {
        addStationMarkers(stops, route.routeColor)
      }
    }

    // A confirmed break does not change WHO renders — portolan keeps the
    // stations, bullets and labels — only what the line's geometry is.
    // The tiles can only draw the timetable's line, and the timetable is
    // what the break disproves, so portolan is handed the running span
    // and draws that as the isolated ribbon instead.
    portolan.setIsolatedRouteGeometry(
      broken ? runningSlice(route) : null,
      route.routeColor,
    )

    // First paint, from what is knowable right now. Optimistic about
    // portolan: asking for the token this instant would answer "no" for a
    // route it draws perfectly well, because the tiles that answer are
    // still arriving with the fit. Narrowing the ribbons to a route that
    // turns out to be nothing shows nothing for a moment; drawing the
    // overlay over ribbons that turn out to draw the route shows the line
    // twice, in two styles — so lean portolan whenever it is on at all.
    // Points spread along THIS route pin the answer to its geometry: several
    // feeds can share a bare id, and a shared terminal (LIRR and Metro-North
    // both reach Grand Central) means one stop cannot tell them apart. Ends
    // and middles can.
    const along: [number, number][] = (() => {
      const stops = route.stops
      if (!stops.length) return []
      const want = Math.min(8, stops.length)
      const step = (stops.length - 1) / Math.max(1, want - 1)
      const out: [number, number][] = []
      for (let i = 0; i < want; i++) {
        const s = stops[Math.round(i * step)]
        if (s) out.push([s.lng, s.lat])
      }
      return out
    })()

    // The question is whether portolan is TURNED ON, not whether it has
    // finished hydrating: on a cold load it is enabled but not ready for a
    // second or so, and drawing the overlay in that gap put the plain
    // shape-and-circles labels on screen only to replace them with
    // portolan's bulleted ones a moment later. Nothing at all is the better
    // first frame — the reconciler fills it in as soon as the tiles can
    // answer, and the overlay is still there for feeds portolan does not
    // draw.
    if (route.routeId && portolan.isPortolanTransitEnabled()) {
      // ONLY a resolved token may be isolated. The bare GTFS id is not a
      // portolan token: tokens are prefixed per feed (`f3:2`) for every feed
      // after the first, so an UNPREFIXED id addresses the first feed's
      // route of that number — isolating Metro-North's 2 on the bare `2`
      // lit up the LIRR. There is no safe guess here; when the token cannot
      // be verified the reconciler asks again, and until it can, nothing is
      // isolated at all.
      const token = portolan.portolanTransitActive()
        ? portolan.portolanRouteToken(route.routeId, along)
        : null
      if (token) renderViaPortolan(token)
    } else {
      renderViaOverlay()
    }

    // Then reconcile on every idle until the answer is definitive. One
    // idle was never enough: the first can fire before the route's tiles
    // arrive (the fit is an 800ms ease), and portolan's own hydration can
    // finish long after the panel opened — the decide-once version of this
    // is exactly how a route ended up drawn twice.
    if (!route.routeId) return
    let missesWhileReady = 0
    let waitsForHydration = 0
    const reconcile = () => {
      if (generation !== isolationGeneration) return detachReconciler()
      if (!portolan.portolanTransitActive()) {
        // Hydration still coming. It normally lands within a couple of
        // idles; if it never does, fall back rather than leave the route
        // undrawn entirely.
        if (++waitsForHydration >= 6) {
          renderViaOverlay()
          detachReconciler()
        }
        return
      }
      const token = portolan.portolanRouteToken(route.routeId!, along)
      if (token) {
        renderViaPortolan(token)
        return detachReconciler()
      }
      // Ready, tiles idle, still unknown. Once the fit has landed and the
      // tiles under it have answered a few times, that IS the answer: no
      // pyramid draws this route here.
      if (++missesWhileReady >= 3) {
        renderViaOverlay()
        detachReconciler()
      }
    }
    reconciler = reconcile
    mapInstance.on('idle', reconcile)
  }

  function detachReconciler() {
    if (reconciler && mapInstance) mapInstance.off('idle', reconciler)
    reconciler = null
  }

  function removeIsolation() {
    if (!mapInstance || !isIsolated) return
    isolationGeneration++
    renderedSig = ''
    detachReconciler()

    if (portolanIsolated) {
      portolan.setIsolatedRoute(null)
      portolanIsolated = false
    }
    portolan.setIsolatedRouteGeometry(null)

    // Restore transit layer opacity
    fadeTransitLayers(null)

    removeRouteOverlay()

    isIsolated = false
  }

  function fitToRoute(route: {
    coordinates: [number, number][] | null
    stops: RouteDetailStop[]
  }) {
    if (!mapInstance) return

    let north = -90, south = 90, east = -180, west = 180

    if (route.coordinates) {
      for (const [lng, lat] of route.coordinates) {
        if (lat > north) north = lat
        if (lat < south) south = lat
        if (lng > east) east = lng
        if (lng < west) west = lng
      }
    }
    for (const stop of route.stops) {
      if (stop.lat > north) north = stop.lat
      if (stop.lat < south) south = stop.lat
      if (stop.lng > east) east = stop.lng
      if (stop.lng < west) west = stop.lng
    }

    if (north === -90) return

    try {
      // The obstruction-aware wrapper, not the raw camera call. Two reasons,
      // and both of them are why a route sometimes opened half-framed: the
      // panel's width is not ours to guess (420 was a guess), and the sheet
      // is still sliding in when this fires — every frame of that slide calls
      // `setPadding`, which stops the in-flight animation dead, leaving the
      // camera wherever the ease had got to. The wrapper fits again once the
      // drawer settles, against the padding it settled at.
      if (fitBoundsFn) {
        fitBoundsFn(
          { minLng: west, minLat: south, maxLng: east, maxLat: north },
          { padding: 40, maxZoom: 15, duration: 800 },
        )
        return
      }
      mapInstance.fitBounds(
        [[west, south], [east, north]],
        { padding: 60, duration: 800 },
      )
    } catch { /* fitBounds can throw on degenerate bounds */ }
  }

  /** Opacity paints recorded before fading, keyed `layerId|prop`. The
   *  portolan ribbons carry opacity EXPRESSIONS (per-feed style manifests),
   *  so restore must put back exactly what was there — resetting to null
   *  would flatten them to the spec default. */
  const savedOpacity = new Map<string, any>()

  /** Every layer the isolation dims: the (retired) transitland ids that may
   *  survive as user clones, plus every portolan layer in the current style,
   *  enumerated by prefix — the set is per-feed and per-band, never fixed. */
  function fadeTargetLayerIds(): string[] {
    const ids = [...TRANSIT_LAYER_IDS]
    try {
      for (const layer of mapInstance?.getStyle()?.layers ?? []) {
        if (layer.id.startsWith('portolan-')) ids.push(layer.id)
      }
    } catch {
      // style not ready — the transitland list still applies
    }
    return ids
  }

  function fadeTransitLayers(
    opacity: number | null,
    { skipPortolan = false }: { skipPortolan?: boolean } = {},
  ) {
    if (!mapInstance) return

    for (const layerId of fadeTargetLayerIds()) {
      // when portolan IS the isolation, dimming it would dim the very
      // line being shown
      if (skipPortolan && layerId.startsWith('portolan-')) continue
      try {
        const layer = mapInstance.getLayer(layerId)
        if (!layer) continue
        const props = OPACITY_PROPS[layer.type] ?? []

        for (const prop of props) {
          const key = `${layerId}|${prop}`
          if (opacity === null) {
            // Restore the recorded paint (undefined → null clears cleanly)
            mapInstance.setPaintProperty(layerId, prop, savedOpacity.get(key) ?? null)
          } else {
            if (!savedOpacity.has(key)) {
              savedOpacity.set(key, mapInstance.getPaintProperty(layerId, prop))
            }
            mapInstance.setPaintProperty(layerId, prop, opacity)
          }
        }
      } catch {
        // Layer might not exist in current map style
      }
    }
    if (opacity === null) savedOpacity.clear()
  }

  function addRouteShape(coordinates: [number, number][], color: string | null) {
    if (!mapInstance) return

    removeLayerIfExists(ROUTE_LAYER_ID)
    removeSourceIfExists(ROUTE_SOURCE_ID)

    const lineColor = color ? `#${color}` : '#007cbf'

    // GTFS subway shapes are sparse (points can be 0.5–1.5 km apart), which
    // makes the geojson→tile step drop long segments crossing a vertex-less
    // tile at city zoom — the line breaks into visible gaps. Two defences:
    // densify so every tile has vertices, and tolerance:0 to disable the
    // simplification that drops them.
    mapInstance.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      tolerance: 0,
      buffer: 128,
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: densifyLine(coordinates),
        },
      },
    })

    // One uncased line in the route's own colour, wearing the portolan
    // steady-ribbon aesthetic (round caps/joins, the ribbons' zoom-scaled
    // width curve at unit class width, full opacity) so the isolated route
    // reads as a lifted ribbon rather than a different map. The corrected
    // geometry itself arrives from /transit/shapes — barrelman re-imports
    // portolan-corrected shapes, no client work needed.
    mapInstance.addLayer({
      id: ROUTE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': lineColor,
        'line-width': widthExpr(1),
        'line-opacity': 1,
      },
    })
  }

  function addStationMarkers(
    stops: RouteDetailStop[],
    color: string | null,
  ) {
    if (!mapInstance) return

    removeLayerIfExists(STOPS_LABELS_LAYER_ID)
    removeLayerIfExists(STOPS_LAYER_ID)
    removeSourceIfExists(STOPS_SOURCE_ID)

    const features = stops.map((stop, i) => ({
      type: 'Feature' as const,
      properties: {
        name: stop.stopName,
        isTerminus: i === 0 || i === stops.length - 1,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [stop.lng, stop.lat],
      },
    }))

    mapInstance.addSource(STOPS_SOURCE_ID, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features,
      },
    })

    const stationColor = color ? `#${color}` : '#007cbf'

    // Station circles
    mapInstance.addLayer({
      id: STOPS_LAYER_ID,
      type: 'circle',
      source: STOPS_SOURCE_ID,
      paint: {
        'circle-radius': [
          'case',
          ['get', 'isTerminus'], 6,
          4,
        ],
        'circle-color': '#ffffff',
        'circle-stroke-width': [
          'case',
          ['get', 'isTerminus'], 3,
          2.5,
        ],
        'circle-stroke-color': stationColor,
      },
    })

    // Station labels
    mapInstance.addLayer({
      id: STOPS_LABELS_LAYER_ID,
      type: 'symbol',
      source: STOPS_SOURCE_ID,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 11,
        'text-offset': [1, 0],
        'text-anchor': 'left',
        'text-allow-overlap': false,
        'text-max-width': 12,
      },
      paint: {
        'text-color': '#333333',
        'text-halo-width': 1.5,
        'text-halo-color': '#ffffff',
      },
    })
  }

  function removeLayerIfExists(id: string) {
    try {
      if (mapInstance?.getLayer(id)) {
        mapInstance.removeLayer(id)
      }
    } catch { /* layer doesn't exist */ }
  }

  function removeSourceIfExists(id: string) {
    try {
      if (mapInstance?.getSource(id)) {
        mapInstance.removeSource(id)
      }
    } catch { /* source doesn't exist */ }
  }

  function destroy() {
    removeIsolation()
    watchStop?.()
    watchStop = null
    stopsWatchStop?.()
    stopsWatchStop = null
    mapInstance = null
    fitBoundsFn = null
  }

  return {
    initialize,
    destroy,
  }
}
