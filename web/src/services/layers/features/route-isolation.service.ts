/**
 * Route Isolation Service
 *
 * When a route detail is active, this service lifts the route out of the
 * transit network: the rest of the network dims behind it, and the route
 * keeps its line, its stations and their names and bullets at full
 * strength. It looks the same whoever draws it:
 *
 *   - portolan, where a pyramid covers the route — its own ribbon,
 *     stations and lettering (and the hours: which spans run now);
 *   - portolan drawing the route's OWN shape and stops, where no pyramid
 *     does — a bus in a city with none — through the same station layers,
 *     bullet strips and line style (see setDrawnRoutes);
 *   - a plain shape-and-circles overlay, only when the transit layer is
 *     off and portolan is not on the map at all.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { computed, watch, type WatchStopHandle } from 'vue'
import type { RouteDetail, RouteDetailStop } from '@/types/transit.types'
import { useRouteDetailStore } from '@/stores/route-detail.store'
import { densifyLine } from '@/lib/geo/geo-densify'
import { projectAlong, sliceAlong } from '@/lib/geo/geo-line'
import { widthExpr } from '@/services/layers/features/portolan/portolan-expressions'
import {
  usePortolanTransitService,
  type PortolanDrawnRoute,
} from '@/services/layers/features/portolan/portolan-transit.service'
import { stopBulletsFor } from '@/services/layers/features/portolan/portolan-bullets'
import {
  fadeTransitNetwork,
  networkDimOpacity,
} from '@/services/layers/features/transit-network-dim'
import {
  addStopOverlay,
  removeLayerIfExists,
  removeSourceIfExists,
  removeStopOverlay,
  stopOverlayIds,
} from '@/services/layers/features/transit-stop-overlay'
import type { FitBoundsFn } from '@/types/map.types'

const ROUTE_SOURCE_ID = 'route-detail-shape'
const ROUTE_LAYER_ID = 'route-detail-line'
const STOPS = stopOverlayIds('route-detail-stops')

/** How long the reconciler may go undecided before it settles on a
 *  fallback. Idle is not a heartbeat: a map that has finished its fit and
 *  has nothing left to draw fires it once and then never again, so a
 *  budget counted only in idles could wait forever — a Charlotte bus, with
 *  no pyramid under it, opened on an empty map. Long enough to cover the
 *  fit's 800ms ease and the drawer settling. */
const RECONCILE_DEADLINE_MS = 2500

/** Idles to wait for portolan to hydrate, and idles to keep asking once it
 *  has, before settling on a fallback. */
const HYDRATION_IDLES = 6
const MISS_IDLES = 3

/** Settling on a fallback is not the last word: a pyramid whose tiles land
 *  late — a slow phone, a cold cache — still takes the route back. This
 *  many idles after settling, it stops asking. */
const UPGRADE_IDLES = 20

/** Points spread along a route pin portolan's token to THIS route's
 *  geometry (see portolanRouteToken). */
const TOKEN_PROBES = 8

type Renderer = 'portolan' | 'drawn' | 'overlay'

export function useRouteIsolationService() {
  const routeDetailStore = useRouteDetailStore()
  const portolan = usePortolanTransitService()
  let mapInstance: any = null
  let fitBoundsFn: FitBoundsFn | null = null
  const watchStops: WatchStopHandle[] = []
  let isIsolated = false
  /** Bumps on every isolate/restore, so a deferred answer that belongs to
   *  a route the rider has already navigated away from does nothing. */
  let isolationGeneration = 0
  /** The reconciler for the current isolation: its map listeners and its
   *  deadline, so teardown can unhook both. */
  let reconciler: Array<[string, (e?: any) => void]> | null = null
  let reconcileDeadline: ReturnType<typeof setTimeout> | null = null

  /**
   * Who is drawing this isolation.
   *
   * Portolan, once it claims the route, keeps it: the test for "does
   * portolan draw this route" reads the tiles loaded right now, so it
   * answers no whenever the map has panned off the route, and re-asking
   * let a pan tear portolan's ribbon down mid-view. A fallback is only
   * ever UPGRADED — to portolan when its tiles answer late, from the plain
   * overlay to the drawn route once portolan comes up.
   */
  let renderer: Renderer | null = null
  /** Whether the network dim was asked of portolan here, so teardown knows
   *  to give it back. */
  let networkDimmed = false

  function initialize(map: any, fitBounds?: FitBoundsFn) {
    mapInstance = map
    fitBoundsFn = fitBounds ?? null

    watchStops.push(
      watch(
        () => routeDetailStore.activeRoute,
        (route) => (route ? applyIsolation(route) : removeIsolation()),
        { immediate: true },
      ),
      // What the boards said, so the map's bullets fade the lines that are
      // not running exactly where the stop list fades them.
      watch(
        () => routeDetailStore.runningAtStops,
        (running) => portolan.setStopService('route', running.size ? running : null),
        { immediate: true },
      ),
      // The running path, pushed as it settles (boards answering, alerts
      // landing) so the map's stations track the panel's timeline. Portolan
      // holds it and applies it only while a route is isolated.
      watch(
        () => routeDetailStore.servedStops,
        (stops) =>
          portolan.setIsolatedRouteStops(
            stops.length ? stops.map(s => [s.lng, s.lat] as [number, number]) : null,
          ),
        { immediate: true },
      ),
      // Whatever the panel's data says now, the map says too: the running
      // span, the stops the line calls at and their bullets — which resolve
      // as the curated styles land.
      watch(
        () => [drawnRoute.value, runningGeometry.value] as const,
        () => redraw(),
      ),
    )
  }

  /** The stops the line calls at now, else every stop it has. */
  function stopsOf(route: RouteDetail): RouteDetailStop[] {
    const served = routeDetailStore.servedStops
    return served.length ? served : route.stops
  }

  /**
   * The route's shape cut down to the span between the running path's two
   * end stops, or null when there is nothing to cut with. The ends are
   * found by the stops' own distance-along metric, then projected onto the
   * shape so cut and stop land in the same place.
   */
  function runningSlice(route: RouteDetail): [number, number][] | null {
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

  /** The line the fallbacks draw: the running span, else the whole shape. */
  function lineOf(route: RouteDetail): [number, number][] | null {
    return runningSlice(route) ?? route.coordinates
  }

  /**
   * The route as portolan draws one it has no pyramid for.
   *
   * Each stop carries the bullets its station label would: the line's own
   * and every connection, resolved and ordered by the same code as the stop
   * list beside the map, so a bullet means the same thing on both.
   */
  const drawnRoute = computed((): PortolanDrawnRoute | null => {
    const route = routeDetailStore.activeRoute
    if (!route) return null
    const self = {
      routeId: route.routeId,
      routeShortName: route.routeShortName,
      routeLongName: route.routeLongName,
      routeType: route.routeType,
      routeColor: route.routeColor,
      routeTextColor: route.routeTextColor,
    }
    return {
      color: route.routeColor,
      coordinates: lineOf(route),
      stops: stopsOf(route).map(stop => ({
        name: stop.stopName,
        lng: stop.lng,
        lat: stop.lat,
        bullets: stopBulletsFor(
          [self, ...(stop.routes ?? []).filter(r => r.routeId !== route.routeId)],
          stop,
        ).map(b => ({ label: b.label, color: b.color, shape: b.shape })),
      })),
    }
  })

  /** What portolan's own ribbon should draw: the running span when the
   *  path has left the timetable's line, else the line as tiled. */
  const runningGeometry = computed(() => {
    const route = routeDetailStore.activeRoute
    if (!route) return null
    return routeDetailStore.pathLeavesTrack ? runningSlice(route) : null
  })

  /** Probes spread along the route, to pin portolan's token to it. */
  function probesAlong(route: RouteDetail): [number, number][] {
    const stops = route.stops
    if (!stops.length) return []
    const want = Math.min(TOKEN_PROBES, stops.length)
    const step = (stops.length - 1) / Math.max(1, want - 1)
    const out: [number, number][] = []
    for (let i = 0; i < want; i++) {
      const s = stops[Math.round(i * step)]
      if (s) out.push([s.lng, s.lat])
    }
    return out
  }

  /**
   * Portolan's token for this route, or null.
   *
   * ONLY a resolved token may be isolated. The bare GTFS id is not a
   * portolan token: tokens are prefixed per feed (`f3:2`) for every feed
   * after the first, so an UNPREFIXED id addresses the first feed's route
   * of that number — isolating Metro-North's 2 on the bare `2` lit up the
   * LIRR.
   */
  function tokenFor(route: RouteDetail): string | null {
    if (!route.routeId || !portolan.portolanTransitActive()) return null
    return portolan.portolanRouteToken(route.routeId, probesAlong(route))
  }

  // ── the three renderers ─────────────────────────────────────────────

  function dimNetwork() {
    if (!networkDimmed) {
      networkDimmed = true
      portolan.setNetworkDim(true)
    }
    // the retired transitland layers have no renderer of their own to ask
    fadeTransitNetwork(mapInstance, networkDimOpacity(), { skipPortolan: true })
  }

  function undimNetwork() {
    if (networkDimmed) {
      networkDimmed = false
      portolan.setNetworkDim(false)
    }
    fadeTransitNetwork(mapInstance, null)
  }

  /** Portolan's own ribbon carries the isolation, and dims the rest
   *  itself. */
  function renderViaPortolan(route: RouteDetail, token: string) {
    renderer = 'portolan'
    portolan.setDrawnRoutes(null)
    removeRouteOverlay()
    if (networkDimmed) {
      networkDimmed = false
      portolan.setNetworkDim(false)
    }
    portolan.setIsolatedRoute(token)
    portolan.setIsolatedRouteGeometry(runningGeometry.value, route.routeColor)
    fadeTransitNetwork(mapInstance, null)
    fadeTransitNetwork(mapInstance, networkDimOpacity(), { skipPortolan: true })
  }

  /** No pyramid draws this route: portolan draws its own shape and stops. */
  function renderViaDrawn() {
    renderer = 'drawn'
    removeRouteOverlay()
    dimNetwork()
    portolan.setDrawnRoutes(drawnRoute.value ? [drawnRoute.value] : null)
  }

  /** Portolan is not on the map at all: the plain overlay is all there is. */
  function renderViaOverlay(route: RouteDetail) {
    renderer = 'overlay'
    fadeTransitNetwork(mapInstance, networkDimOpacity())
    const coords = lineOf(route)
    if (coords && coords.length >= 2) addRouteShape(coords, route.routeColor)
    addStopOverlay(
      mapInstance,
      STOPS,
      stopsOf(route).map(s => ({ name: s.stopName, lng: s.lng, lat: s.lat })),
      route.routeColor,
    )
  }

  /** The best fallback available right now. */
  function settle(route: RouteDetail) {
    if (portolan.portolanTransitActive()) renderViaDrawn()
    else renderViaOverlay(route)
  }

  /** The panel's data moved on (the running path settled, bullets
   *  resolved): say it again in whichever renderer has the route. */
  function redraw() {
    const route = routeDetailStore.activeRoute
    if (!isIsolated || !route) return
    if (renderer === 'drawn') {
      portolan.setDrawnRoutes(drawnRoute.value ? [drawnRoute.value] : null)
    } else if (renderer === 'overlay') {
      renderViaOverlay(route)
    } else if (renderer === 'portolan') {
      // The tiles can only draw the timetable's line; when the path has
      // left it, portolan is handed the running span instead.
      portolan.setIsolatedRouteGeometry(runningGeometry.value, route.routeColor)
    }
  }

  function removeRouteOverlay() {
    removeStopOverlay(mapInstance, STOPS)
    removeLayerIfExists(mapInstance, ROUTE_LAYER_ID)
    removeSourceIfExists(mapInstance, ROUTE_SOURCE_ID)
  }

  // ── deciding who draws ──────────────────────────────────────────────

  function applyIsolation(route: RouteDetail) {
    if (!mapInstance) return
    teardown()
    fitToRoute(route)
    const generation = ++isolationGeneration
    isIsolated = true

    if (!portolan.isPortolanTransitEnabled()) {
      renderViaOverlay(route)
      return
    }

    // First paint, from what is knowable right now. Optimistic about
    // portolan: the tiles that answer are still arriving with the fit, and
    // a fallback drawn in that gap only to be replaced a moment later shows
    // the line twice, in two styles. Nothing at all is the better first
    // frame — the reconciler fills it in.
    const token = tokenFor(route)
    if (token) {
      renderViaPortolan(route, token)
      return
    }

    // Then reconcile until the answer is definitive, and past it: a
    // fallback is upgraded if portolan claims the route late.
    let waitsForHydration = 0
    let missesWhileReady = 0
    let idlesSinceSettled = 0
    const tryPortolan = (): boolean => {
      const t = tokenFor(route)
      if (!t) return false
      renderViaPortolan(route, t)
      detachReconciler()
      return true
    }
    const onIdle = () => {
      if (generation !== isolationGeneration) return detachReconciler()
      if (tryPortolan()) return
      if (renderer) {
        // the overlay steps up to the drawn route once portolan is up
        if (renderer === 'overlay' && portolan.portolanTransitActive()) renderViaDrawn()
        if (++idlesSinceSettled >= UPGRADE_IDLES) detachReconciler()
        return
      }
      if (!portolan.portolanTransitActive()) {
        if (++waitsForHydration >= HYDRATION_IDLES) settle(route)
        return
      }
      // Ready, tiles idle, still unknown. Once the fit has landed and the
      // tiles under it have answered a few times, that IS the answer: no
      // pyramid draws this route here.
      if (++missesWhileReady >= MISS_IDLES) settle(route)
    }
    // A portolan tile source finishing is the earliest instant its token
    // can be resolved; it only ever answers, never counts toward a miss.
    const onSourceData = (e: any) => {
      if (generation !== isolationGeneration) return detachReconciler()
      if (!String(e?.sourceId ?? '').startsWith('portolan-tiles-')) return
      if (e.isSourceLoaded) tryPortolan()
    }
    reconciler = [
      ['idle', onIdle],
      ['sourcedata', onSourceData],
    ]
    for (const [ev, fn] of reconciler) mapInstance.on(ev, fn)

    reconcileDeadline = setTimeout(() => {
      reconcileDeadline = null
      if (generation === isolationGeneration && !renderer) settle(route)
    }, RECONCILE_DEADLINE_MS)
  }

  function detachReconciler() {
    for (const [ev, fn] of reconciler ?? []) mapInstance?.off(ev, fn)
    reconciler = null
    if (reconcileDeadline) clearTimeout(reconcileDeadline)
    reconcileDeadline = null
  }

  /** Take down whatever is drawing the current isolation. */
  function teardown() {
    detachReconciler()
    if (renderer === 'portolan') portolan.setIsolatedRoute(null)
    portolan.setIsolatedRouteGeometry(null)
    portolan.setDrawnRoutes(null)
    removeRouteOverlay()
    undimNetwork()
    renderer = null
  }

  function removeIsolation() {
    if (!mapInstance || !isIsolated) return
    isolationGeneration++
    teardown()
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

  function addRouteShape(coordinates: [number, number][], color: string | null) {
    if (!mapInstance) return

    removeLayerIfExists(mapInstance, ROUTE_LAYER_ID)
    removeSourceIfExists(mapInstance, ROUTE_SOURCE_ID)

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

  function destroy() {
    removeIsolation()
    for (const stop of watchStops.splice(0)) stop()
    mapInstance = null
    fitBoundsFn = null
  }

  return {
    initialize,
    destroy,
  }
}
