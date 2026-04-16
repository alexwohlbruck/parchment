import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import {
  TripOption as Trip,
  TimelineSegment as TripSegment,
  TravelMode,
} from '@/types/directions.types'
import { Layer, LayerType, MapEngine } from '@/types/map.types'
import colors from 'tailwindcss/colors'
import { FeatureCollection } from 'geojson'
import { toRaw } from 'vue'
import WaypointMapIcon from '@/components/map/WaypointMapIcon.vue'
import {
  getTravelModeColor,
  getTravelModeCaseColor,
} from './travel-mode-colors'
import {
  type RouteProfileType,
  getEdgeColor,
  getEdgeCaseColor,
} from './route-profile-colors'
import type { RouteEdgeSegment } from '@/types/directions.types'

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
      // Convert reactive proxy to plain object to avoid proxy issues
      const plainLayer = toRaw(layer)
      this.map.addLayer(plainLayer, overwrite)
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
  private _routeProfile: RouteProfileType | null = null

  constructor(map: MapStrategy, trip: Trip, routeProfile?: RouteProfileType | null) {
    super(map, `trip-${trip.id}`)
    this.trip = trip
    this._routeProfile = routeProfile ?? null
    this.cleanupExistingResources() // Ensure no remnants exist before building
    this.build()
  }

  /**
   * Get the current route profile coloring mode
   */
  get routeProfile(): RouteProfileType | null {
    return this._routeProfile
  }

  /**
   * Update route profile coloring and rebuild layers
   */
  setRouteProfile(profile: RouteProfileType | null): void {
    if (this._routeProfile === profile) return
    this._routeProfile = profile
    this.destroy()
    this.cleanupExistingResources()
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
      this.map.removeLayer(layerId)
    })

    // Remove any existing sources
    potentialSourceIds.forEach(sourceId => {
      this.map.removeSource(sourceId)
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
      
      // Instruction points are now rendered as HTML markers, not as a layer
      // this._addInstructionPointsLayer(segment, segmentIndex)
    })

    // Don't add origin/destination layers here since waypoint markers are managed separately
    // this._addOriginDestinationLayers()
  }

  /**
   * Add instruction points layer for a segment
   */
  private _addInstructionPointsLayer(segment: TripSegment, segmentIndex: number): void {
    // Only add points if there are instructions with coordinates
    const instructionsWithCoords = segment.instructions?.filter(
      (instr: any) => typeof instr === 'object' && instr.coordinate
    )
    
    if (!instructionsWithCoords || instructionsWithCoords.length === 0) return

    const sourceId = `${this.id}-instructions-${segmentIndex}`
    const circleLayerId = `${this.id}-instruction-circles-${segmentIndex}`

    // Create GeoJSON for instruction points
    const features = instructionsWithCoords.map((instr: any, index: number) => ({
      type: 'Feature',
      properties: {
        instructionIndex: index,
        segmentIndex,
        text: instr.text,
      },
      geometry: {
        type: 'Point',
        coordinates: [instr.coordinate.lng, instr.coordinate.lat],
      },
    }))

    const geoJSON: FeatureCollection = {
      type: 'FeatureCollection',
      features: features as any,
    }

    // Add source
    this.map.addSource(sourceId, {
      type: 'geojson',
      data: geoJSON,
    })
    this.sources.add(sourceId)

    // Add circle layer (smaller white circles without numbers)
    this.addLayer({
      id: circleLayerId,
      groupId: this.id,
      name: `Trip ${this.trip.id} Instruction Points ${segmentIndex}`,
      type: LayerType.CUSTOM,
      showInLayerSelector: false,
      visible: true,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 10, // Render on top
      configuration: {
        id: circleLayerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': 3,
          'circle-color': '#ffffff',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': this._getSegmentColor(segment),
          'circle-opacity': 1,
        },
      } as any,
    })
  }

  private _addSegmentLayer(segment: TripSegment, segmentIndex: number): void {
    if (!segment.geometry) return

    // If route profile coloring is active and we have edge segments, render per-edge colored sub-layers
    if (this._routeProfile && segment.edgeSegments && segment.edgeSegments.length > 0) {
      this._addEdgeColoredLayers(segment, segmentIndex)
      return
    }

    // Default: single-color layer for the whole segment
    this._addSingleColorSegmentLayer(segment, segmentIndex)
  }

  /**
   * Add a single-color line layer for a segment (default behavior)
   */
  private _addSingleColorSegmentLayer(segment: TripSegment, segmentIndex: number): void {
    const sourceId = `${this.id}-segment-${segmentIndex}`
    const layerId = `${this.id}-segment-layer-${segmentIndex}`
    const caseLayerId = `${this.id}-segment-case-layer-${segmentIndex}`

    // Ensure source doesn't already exist
    this.map.removeSource(sourceId)

    this.map.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: segment.geometry!.map(c => [c.lng, c.lat]),
        },
      },
    })

    this.sources.add(sourceId)

    // Case layer (border)
    this.addLayer({
      id: caseLayerId,
      groupId: this.id,
      name: `Trip ${this.trip.id} Segment ${segmentIndex} Case`,
      type: LayerType.CUSTOM,
      showInLayerSelector: true,
      visible: true,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 0,
      configuration: {
        id: caseLayerId,
        type: 'line',
        source: sourceId,
        slot: 'middle',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': this._getSegmentCaseColor(segment),
          'line-width': 8,
          'line-opacity': 1.0,
          'line-emissive-strength': 1,
        },
      } as any,
    })

    // Main layer
    this.addLayer({
      id: layerId,
      groupId: this.id,
      name: `Trip ${this.trip.id} Segment ${segmentIndex}`,
      type: LayerType.CUSTOM,
      showInLayerSelector: true,
      visible: true,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 1,
      configuration: {
        id: layerId,
        type: 'line',
        source: sourceId,
        slot: 'middle',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': this._getSegmentColor(segment),
          'line-width': 6,
          'line-opacity': 1.0,
          'line-emissive-strength': 1,
        },
      } as any,
    })
  }

  /**
   * Render a segment with line-gradient coloring based on edge segment data.
   * Uses a single GeoJSON source with lineMetrics and a `step` expression
   * on `line-progress` — no gaps, no splitting into sub-layers.
   */
  private _addEdgeColoredLayers(segment: TripSegment, segmentIndex: number): void {
    const geometry = segment.geometry!
    const edgeSegments = segment.edgeSegments!
    const profile = this._routeProfile!
    const defaultColor = this._getSegmentColor(segment)
    const defaultCaseColor = this._getSegmentCaseColor(segment)

    const sourceId = `${this.id}-segment-${segmentIndex}`
    const layerId = `${this.id}-segment-layer-${segmentIndex}`
    const caseLayerId = `${this.id}-segment-case-layer-${segmentIndex}`

    this.map.removeSource(sourceId)

    // lineMetrics: true is required for line-gradient
    this.map.addSource(sourceId, {
      type: 'geojson',
      lineMetrics: true,
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: geometry.map(c => [c.lng, c.lat]),
        },
      },
    })
    this.sources.add(sourceId)

    // Build cumulative distances for the geometry
    const cumDist: number[] = [0]
    for (let i = 1; i < geometry.length; i++) {
      const prev = geometry[i - 1]
      const curr = geometry[i]
      const d = this._haversine(prev.lat, prev.lng, curr.lat, curr.lng)
      cumDist.push(cumDist[i - 1] + d)
    }
    const totalDist = cumDist[cumDist.length - 1]

    // Build step expression: ['step', ['line-progress'], defaultColor, frac1, color1, frac2, color2, ...]
    // line-progress ranges from 0 to 1 along the line
    const mainStops = this._buildGradientStops(edgeSegments, totalDist, profile, defaultColor, false)
    const caseStops = this._buildGradientStops(edgeSegments, totalDist, profile, defaultCaseColor, true)

    // Case layer (border) — line-gradient cannot combine with line-dasharray
    this.addLayer({
      id: caseLayerId,
      groupId: this.id,
      name: `Trip ${this.trip.id} Segment ${segmentIndex} Case`,
      type: LayerType.CUSTOM,
      showInLayerSelector: false,
      visible: true,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 0,
      configuration: {
        id: caseLayerId,
        type: 'line',
        source: sourceId,
        slot: 'middle',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-gradient': caseStops,
          'line-width': 8,
          'line-opacity': 1.0,
          'line-emissive-strength': 1,
        },
      } as any,
    })

    // Main layer
    this.addLayer({
      id: layerId,
      groupId: this.id,
      name: `Trip ${this.trip.id} Segment ${segmentIndex}`,
      type: LayerType.CUSTOM,
      showInLayerSelector: false,
      visible: true,
      engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
      order: 1,
      configuration: {
        id: layerId,
        type: 'line',
        source: sourceId,
        slot: 'middle',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-gradient': mainStops,
          'line-width': 6,
          'line-opacity': 1.0,
          'line-emissive-strength': 1,
        },
      } as any,
    })
  }

  /**
   * Build a Mapbox/MapLibre `interpolate` expression for line-gradient with
   * smooth transitions between color segments.
   *
   * For each segment we emit a "hold" stop (solid colour) and place two
   * closely-spaced stops at every boundary so the colours blend over a
   * short distance (~30 m or 1 % of the route, whichever is smaller).
   *
   * Returns: ['interpolate', ['linear'], ['line-progress'], f0, c0, f1, c1, …]
   * All fractions **strictly ascending**.
   */
  private _buildGradientStops(
    edgeSegments: RouteEdgeSegment[],
    totalDist: number,
    profile: RouteProfileType,
    fallbackColor: string,
    useCase: boolean,
  ): any[] {
    if (totalDist === 0) {
      return ['interpolate', ['linear'], ['line-progress'], 0, fallbackColor, 1, fallbackColor]
    }

    // Half-width of the transition zone expressed as a fraction of the route.
    // ~10 m, capped at 0.4 % so short routes don't get entirely blurred.
    const TRANSITION_METERS = 10
    const halfT = Math.min(0.004, (TRANSITION_METERS / totalDist) / 2)

    // ---------- helpers ----------
    const colorFor = (edge: RouteEdgeSegment): string =>
      useCase
        ? getEdgeCaseColor(profile, edge, fallbackColor)
        : getEdgeColor(profile, edge, fallbackColor)

    // ---------- collect solid spans ----------
    // Each span: { start, end, color }   (fractions 0-1)
    interface Span { start: number; end: number; color: string }
    const spans: Span[] = []

    for (let i = 0; i < edgeSegments.length; i++) {
      const edge = edgeSegments[i]
      const s = Math.max(0, Math.min(1, edge.startDistance / totalDist))
      const e = Math.max(0, Math.min(1, edge.endDistance / totalDist))
      if (s >= e) continue

      const color = colorFor(edge)

      // Fill any gap before this edge with the fallback colour
      const prevEnd = spans.length > 0 ? spans[spans.length - 1].end : 0
      if (s > prevEnd + 1e-9) {
        spans.push({ start: prevEnd, end: s, color: fallbackColor })
      }

      spans.push({ start: s, end: e, color })
    }

    // Fill tail if last edge doesn't reach the end
    if (spans.length > 0 && spans[spans.length - 1].end < 1 - 1e-9) {
      spans.push({ start: spans[spans.length - 1].end, end: 1, color: fallbackColor })
    }
    // Fill everything if no edges matched
    if (spans.length === 0) {
      return ['interpolate', ['linear'], ['line-progress'], 0, fallbackColor, 1, fallbackColor]
    }

    // ---------- build interpolate stops ----------
    const raw: Array<{ frac: number; color: string }> = []

    for (let i = 0; i < spans.length; i++) {
      const span = spans[i]
      const prev = i > 0 ? spans[i - 1] : null

      if (!prev) {
        // First span — anchor at 0
        raw.push({ frac: 0, color: span.color })
      } else if (prev.color !== span.color) {
        // Transition zone between two different colours
        const boundary = span.start
        const tStart = Math.max(raw[raw.length - 1]?.frac ?? 0, boundary - halfT)
        const tEnd = Math.min(1, boundary + halfT)
        raw.push({ frac: tStart, color: prev.color })
        raw.push({ frac: tEnd, color: span.color })
      }
      // else same colour as previous span — no stop needed, colour carries over
    }

    // Anchor at 1
    const lastColor = spans[spans.length - 1].color
    if (raw.length === 0 || raw[raw.length - 1].frac < 1) {
      raw.push({ frac: 1, color: lastColor })
    }

    // ---------- deduplicate & enforce strictly ascending ----------
    const expr: any[] = ['interpolate', ['linear'], ['line-progress']]
    let lastFrac = -1

    for (const stop of raw) {
      // Nudge forward if we'd duplicate the previous fraction
      let frac = stop.frac
      if (frac <= lastFrac) frac = lastFrac + 1e-6
      frac = Math.min(1, frac)
      if (frac <= lastFrac) continue // can't fit

      expr.push(frac, stop.color)
      lastFrac = frac
    }

    // Safety: interpolate needs at least two stops
    if (expr.length < 5) {
      return ['interpolate', ['linear'], ['line-progress'], 0, fallbackColor, 1, fallbackColor]
    }

    return expr
  }

  /**
   * Haversine distance in meters between two coordinates
   */
  private _haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLng = ((lng2 - lng1) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
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
    this.map.removeSource(sourceId)

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
      id: caseLayerId,
      groupId: this.id,
      name: `Trip ${this.trip.id} Connector ${segmentIndex} Case`,
      type: LayerType.CUSTOM,
      showInLayerSelector: true,
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
      id: layerId,
      groupId: this.id,
      name: `Trip ${this.trip.id} Connector ${segmentIndex}`,
      type: LayerType.CUSTOM,
      showInLayerSelector: true,
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
