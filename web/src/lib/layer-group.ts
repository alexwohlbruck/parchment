import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import {
  TripOption as Trip,
  TimelineSegment as TripSegment,
  TravelMode,
} from '@/types/directions.types'
import { Layer, LayerType, MapEngine } from '@/types/map.types'
import colors from 'tailwindcss/colors'
import { FeatureCollection } from 'geojson'
import WaypointMapIcon from '@/components/map/WaypointMapIcon.vue'
import {
  getTravelModeColor,
  getTravelModeCaseColor,
} from './travel-mode-colors'

/**
 * Base class for managing a collection of map layers as a group
 * Used for dynamically created layers like trip visualization
 * Renamed from LayerGroup to avoid conflicts with the LayerGroup interface
 */
export class MapLayerGroup {
  id: string
  protected layers: Map<string, Layer> = new Map()
  protected map: MapStrategy

  constructor(map: MapStrategy, id?: string) {
    this.map = map
    this.id = id || this._generateGroupId()
  }

  /**
   * Add a layer to this group
   */
  addLayer(layer: Layer, overwrite = false): void {
    const layerId = layer.configuration.id
    if (this.layers.has(layerId) && !overwrite) {
      console.warn(
        `Layer with id ${layerId} already exists in group ${this.id}.`,
      )
      return
    }

    try {
      this.map.addLayer(layer, overwrite)
      this.layers.set(layerId, layer)
    } catch (error) {
      console.error(
        `Failed to add layer ${layerId} to group ${this.id}:`,
        error,
      )
    }
  }

  /**
   * Remove a layer from this group
   */
  removeLayer(layerId: string): void {
    if (this.layers.has(layerId)) {
      try {
        this.map.removeLayer(layerId)
        this.layers.delete(layerId)
      } catch (error) {
        console.error(
          `Failed to remove layer ${layerId} from group ${this.id}:`,
          error,
        )
      }
    }
  }

  /**
   * Toggle visibility of all layers in this group
   */
  toggleVisibility(visible: boolean): void {
    for (const layerId of this.layers.keys()) {
      try {
        this.map.toggleLayerVisibility(layerId, visible)
      } catch (error) {
        console.error(
          `Failed to toggle visibility for layer ${layerId}:`,
          error,
        )
      }
    }
  }

  /**
   * Get all layer IDs in this group
   */
  getLayerIds(): string[] {
    return Array.from(this.layers.keys())
  }

  /**
   * Get all layers in this group
   */
  getLayers(): Layer[] {
    return Array.from(this.layers.values())
  }

  /**
   * Check if this group contains a layer
   */
  hasLayer(layerId: string): boolean {
    return this.layers.has(layerId)
  }

  /**
   * Get the number of layers in this group
   */
  size(): number {
    return this.layers.size
  }

  /**
   * Clean up all layers and sources in this group
   */
  destroy(): void {
    console.log(
      `Destroying MapLayerGroup ${this.id} with ${this.layers.size} layers`,
    )

    // Remove all layers
    for (const layerId of this.layers.keys()) {
      this.removeLayer(layerId)
    }

    // Clean up sources that are only used by this group
    const sources = new Set(
      Array.from(this.layers.values())
        .map(l => l.configuration.source)
        .filter((source): source is string => typeof source === 'string'),
    )

    for (const sourceId of sources) {
      try {
        this.map.removeSource(sourceId)
      } catch (error) {
        // Source might be used by other layers, so this is not necessarily an error
        console.debug(`Could not remove source ${sourceId}:`, error)
      }
    }

    this.layers.clear()
  }

  private _generateGroupId(): string {
    return `map-group-${Math.random().toString(36).substring(2, 9)}`
  }
}

/**
 * Specialized layer group for trip visualization
 * Extends MapLayerGroup with trip-specific functionality
 */
export class TripGroup extends MapLayerGroup {
  trip: Trip
  private sources: Set<string> = new Set() // Track all sources created by this group

  constructor(map: MapStrategy, trip: Trip) {
    super(map, `trip-${trip.id}`)
    this.trip = trip
    this.cleanupExistingResources() // Ensure no remnants exist before building
    this.build()
  }

  /**
   * Clean up any existing layers or sources that might conflict
   */
  private cleanupExistingResources(): void {
    // Clean up any potential remnants with similar IDs
    const potentialLayerIds = [
      ...Array.from({ length: 10 }, (_, i) => `${this.id}-segment-layer-${i}`),
      ...Array.from(
        { length: 10 },
        (_, i) => `${this.id}-connector-layer-${i}`,
      ),
    ]

    const potentialSourceIds = [
      ...Array.from({ length: 10 }, (_, i) => `${this.id}-segment-${i}`),
      ...Array.from({ length: 10 }, (_, i) => `${this.id}-connector-${i}`),
    ]

    // Remove any existing layers
    potentialLayerIds.forEach(layerId => {
      try {
        this.map.removeLayer(layerId)
      } catch (e) {
        // Layer doesn't exist, which is fine
      }
    })

    // Remove any existing sources
    potentialSourceIds.forEach(sourceId => {
      try {
        this.map.removeSource(sourceId)
      } catch (e) {
        // Source doesn't exist, which is fine
      }
    })
  }

  /**
   * Build all trip visualization layers
   */
  private build(): void {
    this.trip.segments.forEach((segment, segmentIndex) => {
      if (!segment.geometry) return
      this._addSegmentLayer(segment, segmentIndex)

      // Add connector between segments
      if (segmentIndex < this.trip.segments.length - 1) {
        const nextSegment = this.trip.segments[segmentIndex + 1]
        if (!nextSegment.geometry) return
        this._addConnectorLayer(segment, nextSegment, segmentIndex)
      }
    })

    // Don't add origin/destination layers here since waypoint markers are managed separately
    // this._addOriginDestinationLayers()
  }

  private _addSegmentLayer(segment: TripSegment, segmentIndex: number): void {
    if (!segment.geometry) return

    const sourceId = `${this.id}-segment-${segmentIndex}`
    const layerId = `${this.id}-segment-layer-${segmentIndex}`
    const caseLayerId = `${this.id}-segment-case-layer-${segmentIndex}`

    // Ensure source doesn't already exist
    try {
      this.map.removeSource(sourceId)
    } catch (e) {
      // Source doesn't exist, which is fine
    }

    this.map.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: segment.geometry.map(c => [c.lng, c.lat]),
        },
      },
    })

    // Track the source for cleanup
    this.sources.add(sourceId)

    // Add the case layer (border) first
    this.addLayer({
      name: `Trip ${this.trip.id} Segment ${segmentIndex} Case`,
      type: LayerType.CUSTOM,
      enabled: true,
      visible: true,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 0, // Add order property
      configuration: {
        id: caseLayerId,
        type: 'line',
        source: sourceId,
        slot: 'middle',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': this._getSegmentCaseColor(segment),
          'line-width': 8,
          'line-opacity': 1.0,
          'line-emissive-strength': 1,
        },
      } as any,
    })

    // Add the main layer on top
    this.addLayer({
      name: `Trip ${this.trip.id} Segment ${segmentIndex}`,
      type: LayerType.CUSTOM,
      enabled: true,
      visible: true,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 1, // Add order property
      configuration: {
        id: layerId,
        type: 'line',
        source: sourceId,
        slot: 'middle',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': this._getSegmentColor(segment),
          'line-width': 6,
          'line-opacity': 1.0,
          'line-emissive-strength': 1,
        },
      } as any,
    })
  }

  private _addConnectorLayer(
    currentSegment: TripSegment,
    nextSegment: TripSegment,
    segmentIndex: number,
  ): void {
    if (!currentSegment.geometry || !nextSegment.geometry) return

    const lastPoint =
      currentSegment.geometry[currentSegment.geometry.length - 1]
    const nextPoint = nextSegment.geometry[0]
    const sourceId = `${this.id}-connector-${segmentIndex}`
    const layerId = `${this.id}-connector-layer-${segmentIndex}`
    const caseLayerId = `${this.id}-connector-case-layer-${segmentIndex}`

    // Ensure source doesn't already exist
    try {
      this.map.removeSource(sourceId)
    } catch (e) {
      // Source doesn't exist, which is fine
    }

    this.map.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [lastPoint.lng, lastPoint.lat],
            [nextPoint.lng, nextPoint.lat],
          ],
        },
      },
    })

    // Track the source for cleanup
    this.sources.add(sourceId)

    // Add the case layer (border) first
    this.addLayer({
      name: `Trip ${this.trip.id} Connector ${segmentIndex} Case`,
      type: LayerType.CUSTOM,
      enabled: true,
      visible: true,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 0, // Add order property
      configuration: {
        id: caseLayerId,
        type: 'line',
        source: sourceId,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': colors.gray[700],
          'line-width': 6,
          'line-dasharray': [1, 2],
          'line-opacity': 1.0,
          'line-emissive-strength': 1,
        },
      } as any,
    })

    // Add the main layer on top
    this.addLayer({
      name: `Trip ${this.trip.id} Connector ${segmentIndex}`,
      type: LayerType.CUSTOM,
      enabled: true,
      visible: true,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 1, // Add order property
      configuration: {
        id: layerId,
        type: 'line',
        source: sourceId,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': colors.gray[500],
          'line-width': 4,
          'line-dasharray': [1, 2],
          'line-opacity': 1.0,
          'line-emissive-strength': 1,
        },
      } as any,
    })
  }

  private _addOriginDestinationLayers(): void {
    // This method is no longer used since waypoint markers are managed separately
    // by the map strategy to ensure they're always visible
    return
  }

  /**
   * Enhanced destroy method for trip groups
   */
  destroy(): void {
    console.log(
      `Destroying TripGroup ${this.id} with ${this.layers.size} layers and ${this.sources.size} sources`,
    )

    // Remove all layers first
    for (const layerId of this.layers.keys()) {
      try {
        this.map.removeLayer(layerId)
        console.log(`Removed layer: ${layerId}`)
      } catch (e) {
        console.warn(`Failed to remove layer ${layerId}:`, e)
      }
    }
    this.layers.clear()

    // Remove all sources
    for (const sourceId of this.sources) {
      try {
        this.map.removeSource(sourceId)
        console.log(`Removed source: ${sourceId}`)
      } catch (e) {
        console.warn(`Failed to remove source ${sourceId}:`, e)
      }
    }
    this.sources.clear()
  }

  private _getSegmentColor(segment: TripSegment): string {
    const { mode, lineColor } = segment
    if (lineColor) {
      return lineColor
    }

    // Use the travel mode color constants to match the trip list UI
    return getTravelModeColor(mode)
  }

  private _getSegmentCaseColor(segment: TripSegment): string {
    const { mode, lineColor } = segment
    if (lineColor) {
      return lineColor
    }

    // Use the travel mode case color constants to match the trip list UI
    return getTravelModeCaseColor(mode)
  }
}
