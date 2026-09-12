/**
 * Stations drawn as circles and names, for the transit portolan does not
 * draw.
 *
 * The pyramids cover the rail-ish feeds portolan has built; a bus route in
 * a city with none still has stops, and this is the only view they have.
 * One renderer for both callers that need it — a route detail lifting its
 * line out of the network, and an itinerary's transit legs — so the two
 * views agree on what a stop looks like.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const DEFAULT_COLOR = '#007cbf'

export interface OverlayStop {
  name: string
  lng: number
  lat: number
}

/** The three ids one overlay owns; distinct per caller so several can be
 *  on the map at once (one per leg of a trip). */
export interface StopOverlayIds {
  source: string
  circles: string
  labels: string
}

export function stopOverlayIds(prefix: string): StopOverlayIds {
  return {
    source: prefix,
    circles: `${prefix}-circles`,
    labels: `${prefix}-labels`,
  }
}

export function removeLayerIfExists(map: any, id: string) {
  try {
    if (map?.getLayer(id)) map.removeLayer(id)
  } catch { /* layer doesn't exist */ }
}

export function removeSourceIfExists(map: any, id: string) {
  try {
    if (map?.getSource(id)) map.removeSource(id)
  } catch { /* source doesn't exist */ }
}

export function removeStopOverlay(map: any, ids: StopOverlayIds) {
  removeLayerIfExists(map, ids.labels)
  removeLayerIfExists(map, ids.circles)
  removeSourceIfExists(map, ids.source)
}

export function addStopOverlay(
  map: any,
  ids: StopOverlayIds,
  stops: OverlayStop[],
  color: string | null,
) {
  if (!map || !stops.length) return

  removeStopOverlay(map, ids)

  const stationColor = color
    ? color.startsWith('#') ? color : `#${color}`
    : DEFAULT_COLOR

  map.addSource(ids.source, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: stops.map((stop, i) => ({
        type: 'Feature' as const,
        properties: {
          name: stop.name,
          isTerminus: i === 0 || i === stops.length - 1,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [stop.lng, stop.lat],
        },
      })),
    },
  })

  map.addLayer({
    id: ids.circles,
    type: 'circle',
    source: ids.source,
    paint: {
      'circle-radius': ['case', ['get', 'isTerminus'], 6, 4],
      'circle-color': '#ffffff',
      'circle-stroke-width': ['case', ['get', 'isTerminus'], 3, 2.5],
      'circle-stroke-color': stationColor,
    },
  })

  map.addLayer({
    id: ids.labels,
    type: 'symbol',
    source: ids.source,
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
