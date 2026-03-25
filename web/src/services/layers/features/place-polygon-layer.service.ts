/**
 * Place Polygon Layer Service
 *
 * Manages layers for displaying place geometries (polygons, multipolygons, linestrings).
 * Used to highlight selected places on the map with fill and stroke layers.
 */

import type { Layer } from '@/types/map.types'
import type { Place } from '@/types/place.types'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import {
  PLACE_POLYGON_SOURCE_ID,
  PLACE_POLYGON_FILL_LAYER_ID,
  PLACE_POLYGON_STROKE_LAYER_ID,
  PLACE_POLYGON_FILL_LAYER_CONFIG,
  PLACE_POLYGON_STROKE_LAYER_CONFIG,
  EMPTY_PLACE_POLYGON_GEOJSON,
  getPlacePolygonFillColor,
  getPlacePolygonStrokeColor,
} from '@/constants/layer.constants'

export function usePlacePolygonLayerService() {
  // Store the last place so we can re-apply after layer (re-)initialization
  // (race condition on first load, or style-change resetting layers to empty)
  let pendingPlace: Partial<Place> | null = null

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  function initializePlacePolygonLayers(mapStrategy: MapStrategy) {
    if (!mapStrategy) return

    // Create polygon source with empty data initially
    try {
      mapStrategy.addSource(PLACE_POLYGON_SOURCE_ID, {
        type: 'geojson',
        data: EMPTY_PLACE_POLYGON_GEOJSON,
      })
    } catch (error) {
      // Source might already exist, update it instead
      const source = mapStrategy.mapInstance.getSource(PLACE_POLYGON_SOURCE_ID)
      if (source) {
        source.setData(EMPTY_PLACE_POLYGON_GEOJSON)
      }
    }

    // Add fill layer (background)
    const fillLayer: Layer = {
      ...PLACE_POLYGON_FILL_LAYER_CONFIG,
      id: PLACE_POLYGON_FILL_LAYER_ID,
      userId: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    mapStrategy.addLayer(fillLayer)

    // Add stroke layer (border)
    const strokeLayer: Layer = {
      ...PLACE_POLYGON_STROKE_LAYER_CONFIG,
      id: PLACE_POLYGON_STROKE_LAYER_ID,
      userId: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    mapStrategy.addLayer(strokeLayer)

    // Re-apply any pending polygon data (handles race condition & style changes)
    if (pendingPlace) {
      updatePlacePolygon(mapStrategy, pendingPlace)
    }
  }

  // ============================================================================
  // DATA UPDATES
  // ============================================================================

  function updatePlacePolygon(
    mapStrategy: MapStrategy,
    place: Partial<Place> | null,
  ) {
    if (!mapStrategy) return

    // Always remember the latest place for replay after (re-)initialization
    pendingPlace = place

    const geoJSON = place
      ? createGeometryGeoJSON(place as Place)
      : EMPTY_PLACE_POLYGON_GEOJSON
    const source = mapStrategy.mapInstance.getSource(PLACE_POLYGON_SOURCE_ID)

    if (source) {
      source.setData(geoJSON)
    }

    // Show/hide layers based on whether we have geometric data
    const hasGeometryData = Boolean(
      place &&
        place.geometry?.value &&
        ((place.geometry.value.type === 'polygon' &&
          ((place.geometry.value.rings && place.geometry.value.rings.length > 0) ||
            (place.geometry.value.nodes && place.geometry.value.nodes.length > 0))) ||
          (place.geometry.value.type === 'multipolygon' &&
            place.geometry.value.polygons &&
            place.geometry.value.polygons.length > 0) ||
          (place.geometry.value.type === 'linestring' &&
            place.geometry.value.nodes &&
            place.geometry.value.nodes.length > 0)),
    )

    // Only toggle visibility if the layers exist
    if (mapStrategy.mapInstance.getLayer(PLACE_POLYGON_FILL_LAYER_ID)) {
      mapStrategy.toggleLayerVisibility(
        PLACE_POLYGON_FILL_LAYER_ID,
        hasGeometryData,
      )
    }
    if (mapStrategy.mapInstance.getLayer(PLACE_POLYGON_STROKE_LAYER_ID)) {
      mapStrategy.toggleLayerVisibility(
        PLACE_POLYGON_STROKE_LAYER_ID,
        hasGeometryData,
      )
    }
  }

  // ============================================================================
  // THEME UPDATES
  // ============================================================================

  function updatePlacePolygonColors(mapStrategy: MapStrategy) {
    if (!mapStrategy) return

    // Check if layers exist before updating paint properties
    if (!mapStrategy.mapInstance.getLayer(PLACE_POLYGON_FILL_LAYER_ID)) {
      return
    }
    if (!mapStrategy.mapInstance.getLayer(PLACE_POLYGON_STROKE_LAYER_ID)) {
      return
    }

    // Update fill layer color
    mapStrategy.mapInstance.setPaintProperty(
      PLACE_POLYGON_FILL_LAYER_ID,
      'fill-color',
      getPlacePolygonFillColor(),
    )

    // Update stroke layer color
    mapStrategy.mapInstance.setPaintProperty(
      PLACE_POLYGON_STROKE_LAYER_ID,
      'line-color',
      getPlacePolygonStrokeColor(),
    )
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  function removePlacePolygonLayers(mapStrategy: MapStrategy) {
    if (!mapStrategy) return

    // Remove layers and source
    mapStrategy.removeLayer(PLACE_POLYGON_STROKE_LAYER_ID)
    mapStrategy.removeLayer(PLACE_POLYGON_FILL_LAYER_ID)
    mapStrategy.removeSource(PLACE_POLYGON_SOURCE_ID)
  }

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  /** Ensure a coordinate ring is closed (first point == last point) */
  function closeRing(coords: number[][]): number[][] {
    if (coords.length < 2) return coords
    const first = coords[0]
    const last = coords[coords.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) {
      coords.push([...first])
    }
    return coords
  }

  function createGeometryGeoJSON(place: Partial<Place>) {
    const geometry = place.geometry?.value
    if (!geometry) {
      return EMPTY_PLACE_POLYGON_GEOJSON
    }

    let geoJSONGeometry: any = null

    switch (geometry.type) {
      case 'linestring':
        if (geometry.nodes && geometry.nodes.length > 0) {
          const coordinates = geometry.nodes.map(node => [node.lng, node.lat])
          geoJSONGeometry = {
            type: 'LineString',
            coordinates,
          }
        }
        break

      case 'polygon':
        if (geometry.rings && geometry.rings.length > 0) {
          // Use rings (supports holes): first ring is exterior, subsequent are holes
          geoJSONGeometry = {
            type: 'Polygon',
            coordinates: geometry.rings.map(ring =>
              closeRing(ring.map(node => [node.lng, node.lat])),
            ),
          }
        } else if (geometry.nodes && geometry.nodes.length > 0) {
          // Fallback to nodes (exterior ring only, for backwards compat)
          geoJSONGeometry = {
            type: 'Polygon',
            coordinates: [
              closeRing(geometry.nodes.map(node => [node.lng, node.lat])),
            ],
          }
        }
        break

      case 'multipolygon':
        if (geometry.polygons && geometry.polygons.length > 0) {
          // Each polygon is an array of rings (first is exterior, subsequent are holes)
          const allPolygons = geometry.polygons.map(polygonRings => {
            if (
              Array.isArray(polygonRings[0]) &&
              polygonRings[0].length > 0 &&
              typeof polygonRings[0][0] === 'object' &&
              'lat' in polygonRings[0][0]
            ) {
              // New format: array of rings, each ring is Coordinates[]
              return (polygonRings as any[]).map((ring: any[]) =>
                closeRing(ring.map((node: any) => [node.lng, node.lat])),
              )
            } else {
              // Legacy flat format: single ring of Coordinates
              return [
                closeRing(
                  (polygonRings as any[]).map((node: any) => [
                    node.lng,
                    node.lat,
                  ]),
                ),
              ]
            }
          })

          geoJSONGeometry = {
            type: 'MultiPolygon',
            coordinates: allPolygons,
          }
        }
        break

      default:
        // Point or unsupported geometry - return empty
        return EMPTY_PLACE_POLYGON_GEOJSON
    }

    if (!geoJSONGeometry) {
      return EMPTY_PLACE_POLYGON_GEOJSON
    }

    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {
            id: place.id,
            name: place.name?.value || '',
            placeType: place.placeType?.value || '',
            geometryType: geometry.type,
          },
          geometry: geoJSONGeometry,
        },
      ],
    }
  }

  return {
    initializePlacePolygonLayers,
    updatePlacePolygon,
    updatePlacePolygonColors,
    removePlacePolygonLayers,
  }
}
