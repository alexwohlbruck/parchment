/**
 * Route Isolation Service
 *
 * When a route detail is active, this service:
 *   1. Fades all existing transit layers to low opacity
 *   2. Adds a highlighted route shape to the map (bold, route-colored)
 *   3. Adds station markers along the route
 *   4. Cleans up when the route is deactivated
 *
 * Designed to work with any MapStrategy that has a mapInstance (Mapbox/MapLibre).
 */

import { watch, type WatchStopHandle } from 'vue'
import { useRouteDetailStore, type RouteDetailStop } from '@/stores/route-detail.store'
import { densifyLine } from '@/lib/geo-densify'
import { widthExpr } from '@/services/layers/features/portolan/portolan-expressions'
import { usePortolanTransitService } from '@/services/layers/features/portolan/portolan-transit.service'

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
  let watchStop: WatchStopHandle | null = null
  let isIsolated = false
  /** True while portolan's own layers are carrying the isolation, so the
   *  teardown knows to widen them again rather than un-fade them. */
  let portolanIsolated = false
  /** Bumps on every isolate/restore, so a deferred confirmation that
   *  belongs to a route the rider has already navigated away from does
   *  nothing at all. */
  let isolationGeneration = 0

  function initialize(map: any) {
    mapInstance = map

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
  }

  /**
   * Isolate by NARROWING portolan rather than drawing over it.
   *
   * Where portolan draws the route, its own ribbons already have the
   * geometry, the colour, the stations and the labels — and, uniquely,
   * the hours: a per-route mask on every segment, which is the only thing
   * on this map that knows the 5 runs a fraction of its route at night or
   * that the B stops running at all. Filtering those layers to one route
   * at one instant therefore shows the path as it IS, not the canonical
   * full-length shape, and the stops on the parts that are not running
   * disappear with the track rather than floating over blank ground.
   *
   * Where portolan does not draw it — a bus in a city with no pyramid —
   * the shape-and-circles view is still the only view there is.
   */
  function applyIsolation(route: {
    routeId?: string
    routeColor: string | null
    coordinates: [number, number][] | null
    stops: RouteDetailStop[]
  }) {
    if (!mapInstance) return

    // Fit map to route bounds
    fitToRoute(route)

    // Try portolan first, and confirm rather than pre-check: the tiles
    // this route lives in may not be loaded at the instant the panel
    // opens — the fit above is an 800ms animation — so asking now would
    // answer "no" for a route portolan draws perfectly well. Narrowing
    // the layers is harmless while we wait: at worst they show one route
    // that turns out to be nothing, for one frame.
    const generation = ++isolationGeneration
    if (route.routeId && portolan.portolanTransitActive()) {
      portolanIsolated = true
      // the id as portolan knows it: a group pyramid prefixes every feed
      // after the first, so the 2 is `f3:2` there and plain `2` alone
      portolan.setIsolatedRoute(portolan.portolanRouteToken(route.routeId) ?? route.routeId)
      // everything that is not portolan still steps back
      fadeTransitLayers(0.15, { skipPortolan: true })
      isIsolated = true
      mapInstance.once('idle', () => {
        if (generation !== isolationGeneration || !portolanIsolated) return
        const token = portolan.portolanRouteToken(route.routeId!)
        if (token) {
          // the tiles that answer may only have arrived with the fit
          portolan.setIsolatedRoute(token)
          return
        }
        // portolan has no such route here — a bus in a city with no
        // pyramid. Hand it back to the shape-and-circles view.
        portolan.setIsolatedRoute(null)
        portolanIsolated = false
        fadeTransitLayers(null)
        fadeTransitLayers(0.15)
        if (route.coordinates && route.coordinates.length >= 2) {
          addRouteShape(route.coordinates, route.routeColor)
        }
        if (route.stops.length > 0) {
          addStationMarkers(route.stops, route.routeColor)
        }
      })
      return
    }

    // Fade existing transit layers
    fadeTransitLayers(0.15)

    // Add route shape
    if (route.coordinates && route.coordinates.length >= 2) {
      addRouteShape(route.coordinates, route.routeColor)
    }

    // Add station markers
    if (route.stops.length > 0) {
      addStationMarkers(route.stops, route.routeColor)
    }

    isIsolated = true
  }

  function removeIsolation() {
    if (!mapInstance || !isIsolated) return
    isolationGeneration++

    if (portolanIsolated) {
      portolan.setIsolatedRoute(null)
      portolanIsolated = false
    }

    // Restore transit layer opacity
    fadeTransitLayers(null)

    // Remove route shape layers
    removeLayerIfExists(ROUTE_LAYER_ID)
    removeSourceIfExists(ROUTE_SOURCE_ID)

    // Remove station markers
    removeLayerIfExists(STOPS_LABELS_LAYER_ID)
    removeLayerIfExists(STOPS_LAYER_ID)
    removeSourceIfExists(STOPS_SOURCE_ID)

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
      mapInstance.fitBounds(
        [[west, south], [east, north]],
        { padding: { top: 60, bottom: 60, left: 420, right: 60 }, duration: 800 },
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
    mapInstance = null
  }

  return {
    initialize,
    destroy,
  }
}
