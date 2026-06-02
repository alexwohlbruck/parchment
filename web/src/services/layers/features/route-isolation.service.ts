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

const ROUTE_SOURCE_ID = 'route-detail-shape'
const ROUTE_LAYER_ID = 'route-detail-line'
const ROUTE_OUTLINE_LAYER_ID = 'route-detail-outline'
const STOPS_SOURCE_ID = 'route-detail-stops'
const STOPS_LAYER_ID = 'route-detail-stops-circles'
const STOPS_LABELS_LAYER_ID = 'route-detail-stops-labels'

/** Layer IDs in the transit group that should be faded when isolating. */
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
  'transitland-route-active',
  'transitland-tram-labels',
  'transitland-metro-labels',
  'transitland-rail-labels',
  'transitland-bus-medium-labels',
  'transitland-other-labels',
  'transitland-stops',
  'transitland-stops-labels',
]

export function useRouteIsolationService() {
  const routeDetailStore = useRouteDetailStore()
  let mapInstance: any = null
  let watchStop: WatchStopHandle | null = null
  let isIsolated = false

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

  function applyIsolation(route: {
    routeColor: string | null
    coordinates: [number, number][] | null
    stops: RouteDetailStop[]
  }) {
    if (!mapInstance) return

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

    // Restore transit layer opacity
    fadeTransitLayers(null)

    // Remove route shape layers
    removeLayerIfExists(ROUTE_LAYER_ID)
    removeLayerIfExists(ROUTE_OUTLINE_LAYER_ID)
    removeSourceIfExists(ROUTE_SOURCE_ID)

    // Remove station markers
    removeLayerIfExists(STOPS_LABELS_LAYER_ID)
    removeLayerIfExists(STOPS_LAYER_ID)
    removeSourceIfExists(STOPS_SOURCE_ID)

    isIsolated = false
  }

  function fadeTransitLayers(opacity: number | null) {
    if (!mapInstance) return

    for (const layerId of TRANSIT_LAYER_IDS) {
      try {
        if (!mapInstance.getLayer(layerId)) continue

        if (opacity === null) {
          // Restore — remove the opacity override
          const layer = mapInstance.getLayer(layerId)
          const type = layer?.type
          if (type === 'line') {
            mapInstance.setPaintProperty(layerId, 'line-opacity', null)
          } else if (type === 'circle') {
            mapInstance.setPaintProperty(layerId, 'circle-opacity', null)
            mapInstance.setPaintProperty(layerId, 'circle-stroke-opacity', null)
          } else if (type === 'symbol') {
            mapInstance.setPaintProperty(layerId, 'text-opacity', null)
            mapInstance.setPaintProperty(layerId, 'icon-opacity', null)
          }
        } else {
          const layer = mapInstance.getLayer(layerId)
          const type = layer?.type
          if (type === 'line') {
            mapInstance.setPaintProperty(layerId, 'line-opacity', opacity)
          } else if (type === 'circle') {
            mapInstance.setPaintProperty(layerId, 'circle-opacity', opacity)
            mapInstance.setPaintProperty(layerId, 'circle-stroke-opacity', opacity)
          } else if (type === 'symbol') {
            mapInstance.setPaintProperty(layerId, 'text-opacity', opacity)
            mapInstance.setPaintProperty(layerId, 'icon-opacity', opacity)
          }
        }
      } catch {
        // Layer might not exist in current map style
      }
    }
  }

  function addRouteShape(coordinates: [number, number][], color: string | null) {
    if (!mapInstance) return

    removeLayerIfExists(ROUTE_LAYER_ID)
    removeLayerIfExists(ROUTE_OUTLINE_LAYER_ID)
    removeSourceIfExists(ROUTE_SOURCE_ID)

    const lineColor = color ? `#${color}` : '#007cbf'

    mapInstance.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates,
        },
      },
    })

    // White outline
    mapInstance.addLayer({
      id: ROUTE_OUTLINE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': 7,
        'line-opacity': 1,
      },
    })

    // Colored line
    mapInstance.addLayer({
      id: ROUTE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': lineColor,
        'line-width': 4,
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
