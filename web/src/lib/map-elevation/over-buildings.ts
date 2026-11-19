/**
 * Lines the user is drawing, kept above the 3D buildings.
 *
 * Over terrain the MapLibre fork drapes every flat line beneath the buildings,
 * whatever its place in the style. A line with an elevation profile is drawn in
 * 3D instead, and with no depth occlusion it draws over them. The profile here
 * holds each line on the ground.
 */

import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import { MapEngine } from '@/types/map.types'
import { OCCLUSION_PROPERTY, PROFILE_PROPERTY } from '@/lib/map-elevation/elevated-lines'
import { withEmissive } from '@/lib/map/mapbox-style-compat'

const PROFILE_KEY = 'groundProfile'

/** One run along a line at the terrain's own height: `~` then lng, lat (1e-7°) and height (dm), deltas after the first. */
function groundRun(positions: Position[]): string | null {
  if (positions.length < 2) return null
  const values: number[] = []
  let lng = 0
  let lat = 0
  for (const [x, y] of positions) {
    const nextLng = Math.round(x * 1e7)
    const nextLat = Math.round(y * 1e7)
    values.push(nextLng - lng, nextLat - lat, 0)
    lng = nextLng
    lat = nextLat
  }
  return `~${values.join(',')}`
}

function lines(geometry: Geometry | null): Position[][] {
  switch (geometry?.type) {
    case 'LineString':
      return [geometry.coordinates]
    case 'MultiLineString':
    case 'Polygon':
      return geometry.coordinates
    case 'MultiPolygon':
      return geometry.coordinates.flat()
    default:
      return []
  }
}

export function groundProfile(geometry: Geometry | null): string {
  return lines(geometry)
    .map(groundRun)
    .filter((run): run is string => run !== null)
    .join(';')
}

function withProfile(feature: Feature): Feature {
  return {
    ...feature,
    properties: { ...feature.properties, [PROFILE_KEY]: groundProfile(feature.geometry) },
  }
}

/** The same data, each feature carrying the profile `overBuildings` reads. */
export function withGroundProfiles<T extends Feature | FeatureCollection>(data: T): T {
  if (data.type === 'Feature') return withProfile(data) as T
  return { ...data, features: data.features.map(withProfile) } as T
}

/** A line layer drawn above the buildings on MapLibre. Its source must hold `withGroundProfiles` data. */
export function overBuildings<T extends { type: string; layout?: object; paint?: object }>(
  layer: T,
  engine: MapEngine,
): T {
  if (engine !== MapEngine.MAPLIBRE || layer.type !== 'line') return layer
  return {
    ...layer,
    layout: { ...layer.layout, [PROFILE_PROPERTY]: ['coalesce', ['get', PROFILE_KEY], ''] },
    paint: { ...layer.paint, [OCCLUSION_PROPERTY]: 0 },
  }
}

/** An overlay the user draws: lit on Mapbox, above the buildings on MapLibre. */
export function drawnOverlayLayer<T extends { type: string; layout?: object; paint?: object }>(
  layer: T,
  engine: MapEngine,
): T {
  return overBuildings(withEmissive(layer, engine), engine)
}
