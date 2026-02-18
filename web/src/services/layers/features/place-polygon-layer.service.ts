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
  }

  // ============================================================================
  // DATA UPDATES
  // ============================================================================

  function updatePlacePolygon(
    mapStrategy: MapStrategy,
    place: Partial<Place> | null,
  ) {
    if (!mapStrategy) return

    const geoJSON = place
      ? createGeometryGeoJSON(place as Place)
      : EMPTY_PLACE_POLYGON_GEOJSON
    const source = mapStrategy.mapInstance.getSource(PLACE_POLYGON_SOURCE_ID)

    if (source) {
      source.setData(geoJSON)
    }

    // Show/hide layers based on whether we have geometric data (polygon, multipolygon, or linestring)
    const hasGeometryData = Boolean(
      place &&
        place.geometry?.value &&
        // Check for polygon/multipolygon with nodes
        ((place.geometry.value.type === 'polygon' &&
          place.geometry.value.nodes &&
          place.geometry.value.nodes.length > 0) ||
          (place.geometry.value.type === 'multipolygon' &&
            place.geometry.value.polygons &&
            place.geometry.value.polygons.length > 0) ||
          // Check for linestring with nodes
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
      console.warn('Place polygon fill layer does not exist yet')
      return
    }
    if (!mapStrategy.mapInstance.getLayer(PLACE_POLYGON_STROKE_LAYER_ID)) {
      console.warn('Place polygon stroke layer does not exist yet')
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
        if (geometry.nodes && geometry.nodes.length > 0) {
          const coordinates = geometry.nodes.map(node => [node.lng, node.lat])

          // Ensure the polygon is closed by adding the first point at the end if needed
          if (coordinates.length > 0) {
            const firstPoint = coordinates[0]
            const lastPoint = coordinates[coordinates.length - 1]
            if (
              firstPoint[0] !== lastPoint[0] ||
              firstPoint[1] !== lastPoint[1]
            ) {
              coordinates.push(firstPoint)
            }
          }

          geoJSONGeometry = {
            type: 'Polygon',
            coordinates: [coordinates], // Single ring for now (exterior only)
          }
        }
        break

      case 'multipolygon':
        if (geometry.polygons && geometry.polygons.length > 0) {
          // Handle multiple polygons properly
          const allPolygons = geometry.polygons.map(polygonNodes => {
            const coordinates = polygonNodes.map(node => [node.lng, node.lat])

            // Ensure each polygon is closed
            if (coordinates.length > 0) {
              const firstPoint = coordinates[0]
              const lastPoint = coordinates[coordinates.length - 1]
              if (
                firstPoint[0] !== lastPoint[0] ||
                firstPoint[1] !== lastPoint[1]
              ) {
                coordinates.push(firstPoint)
              }
            }

            return [coordinates] // Each polygon has one ring (exterior only for now)
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
