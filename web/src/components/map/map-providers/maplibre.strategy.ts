import { MapStrategy } from './map.strategy'
import {
  Map as MaplibreMap,
  NavigationControl,
  GeolocateControl,
  AttributionControl,
  ScaleControl,
  LngLatBounds,
  LngLatLike,
  Marker,
  GeoJSONSource,
  LngLat as MaplibreLngLat,
  CameraOptions,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Basemap,
  MapTheme,
  MapStyleId,
  MapSettings,
  Layer,
  MapCamera,
  Pegman,
  MapillaryImage,
  MapProjection,
  LngLat,
  Waypoint,
  LayerType,
} from '@/types/map.types'

import { Directions, TripsResponse } from '@/types/directions.types'
import { decodeShape } from '@/lib/utils'
import colors from 'tailwindcss/colors'
import { mapEventBus } from '@/lib/eventBus'
import {
  mapboxLayerToMaplibreLayer,
  parsePlanetilerOsmId,
} from '@/lib/map.utils'
import { useMapStore } from '@/stores/map.store'
import { useMapToolsStore } from '@/stores/map-tools.store'
import { createPegmanLayers, updatePegmanData } from '@/lib/pegman.utils'
import { MapLayerGroup, TripGroup } from '@/lib/layer-group'
import { Component, watch } from 'vue'
import { createVueMarkerElement } from '@/lib/vue-marker.utils'
import WaypointMapIcon from '@/components/map/WaypointMapIcon.vue'
import InstructionPointMarker from '@/components/map/InstructionPointMarker.vue'
import { useAppStore } from '@/stores/app.store'
import { useThemeStore } from '@/stores/theme.store'
import { buildMapStyle, buildSatelliteStyle } from '@/lib/basemap-style'
import {
  type BasemapStyleConfig,
  getStyleConfig,
  styleConfigs,
} from '@/lib/basemap-style-config'
import {
  rgbToHex,
  adjustLightness,
} from '@/lib/utils'
function getPrimaryThemeHex(): string {
  try {
    const span = document.createElement('span')
    span.style.position = 'absolute'
    span.style.left = '-9999px'
    span.className = 'text-primary'
    document.body.appendChild(span)
    const color = getComputedStyle(span).color
    document.body.removeChild(span)
    return rgbToHex(color)
  } catch {
    return '#04CB63'
  }
}

function buildStreetViewPaint(configuration: any) {
  const primary = getPrimaryThemeHex()
  const fill = adjustLightness(primary, 8)
  const stroke = adjustLightness(primary, -18)
  const paint: any = { ...(configuration?.paint || {}) }
  if (configuration.type === 'circle') {
    paint['circle-color'] = fill
    paint['circle-opacity'] = paint['circle-opacity'] ?? 0.85
    paint['circle-stroke-color'] = stroke
    paint['circle-stroke-width'] = paint['circle-stroke-width'] ?? 1.5
    paint['circle-stroke-opacity'] = paint['circle-stroke-opacity'] ?? 0.9
    paint['circle-emissive-strength'] = paint['circle-emissive-strength'] ?? 1
  }
  if (configuration.type === 'line') {
    paint['line-color'] = stroke
    paint['line-opacity'] = paint['line-opacity'] ?? 0.8
    paint['line-emissive-strength'] = paint['line-emissive-strength'] ?? 1
  }
  return paint
}

function applyThemedStreetViewStyling(layer: Layer): Layer {
  if (layer.type !== LayerType.STREET_VIEW) return layer
  const cloned: Layer = JSON.parse(JSON.stringify(layer))
  cloned.configuration.paint = buildStreetViewPaint(cloned.configuration)
  return cloned
}

export class MaplibreStrategy extends MapStrategy {
  mapInstance: MaplibreMap
  geolocateControl: GeolocateControl
  layerGroups: Map<string, MapLayerGroup> = new Map()
  private streetViewLayerIds: Set<string> = new Set()
  private unwatchTheme?: () => void
  private tileServerUrl?: string
  private tileKey?: string
  private currentBasemap: Basemap = 'standard'
  private clickDebounceTimer: number | null = null
  private poiHandlerCleanup: (() => void) | null = null
  private styleConfig: BasemapStyleConfig

  constructor(
    container: string | HTMLElement,
    options: MapSettings,
    accessToken?: string,
    tileServerUrl?: string,
    tileKey?: string,
  ) {
    super(container, options, accessToken)
    this.tileServerUrl = tileServerUrl
    this.tileKey = tileKey
    // Resolve the style config for the persisted map style
    this.styleConfig = getStyleConfig(options.mapStyle ?? 'osm-liberty')
    // Seed currentBasemap from the persisted map settings so that engine
    // swaps preserve satellite/hybrid mode. Without this, a fresh strategy
    // instance always started on 'standard' and only picked up the real
    // basemap after the user re-toggled it.
    this.currentBasemap = options.basemap ?? 'standard'
    const { center, zoom, bearing, pitch } = options.camera || {}

    this.mapInstance = new MaplibreMap({
      container,
      style: this.buildCurrentStyle(),
      center: center as LngLatLike,
      bearing,
      pitch,
      zoom,
      attributionControl: false,
      transformRequest: (url, resourceType) => {
        // Add auth header for tile requests to the barrelman tile proxy
        if (
          this.tileKey &&
          this.tileServerUrl &&
          url.startsWith(this.tileServerUrl)
        ) {
          return {
            url,
            headers: {
              Authorization: `Bearer ${this.tileKey}`,
            },
          }
        }
        return { url }
      },
    })

    // Add geolocate control but hide it off-screen
    this.geolocateControl = new GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true,
      },
      trackUserLocation: true,
      showUserLocation: true,
      showAccuracyCircle: true,
    })

    this.addControls()
    this.configureEventListeners()

    const theme = useThemeStore()
    this.unwatchTheme = watch(
      () => theme.accentColor,
      () => this.updateStreetViewColors(),
    )
  }

  addControls() {
    this.mapInstance.addControl(
      new AttributionControl({
        compact: true,
      }),
      'bottom-left',
    )
    this.mapInstance.addControl(this.geolocateControl, 'top-left')
  }

  configureEventListeners() {
    this.mapInstance.on('load', () => {
      mapEventBus.emit('load', this.mapInstance)
    })
    // Style load fires on the initial style load AND on every subsequent
    // setStyle() call (theme change, basemap change, map style change). We
    // use this single listener to re-emit to the mapEventBus so that
    // map.service re-registers all custom layers after the style is replaced.
    //
    // Note: setupPoiHandlers() is idempotent — it early-returns if handlers
    // are already attached, because MapLibre's layer-scoped delegates use
    // getLayer() on each event and automatically adapt to style changes.
    this.mapInstance.on('style.load', () => {
      this.styleConfig = getStyleConfig(this.options.mapStyle ?? 'osm-liberty')
      this.setupPoiHandlers()
      mapEventBus.emit('style.load', this.mapInstance)
    })
    this.mapInstance.on('move', () => {
      mapEventBus.emit('move', {
        center: this.mapInstance.getCenter(),
        zoom: this.mapInstance.getZoom(),
        bearing: this.mapInstance.getBearing(),
        pitch: this.mapInstance.getPitch(),
      })
    })
    this.mapInstance.on('moveend', () => {
      mapEventBus.emit('moveend', {
        center: this.mapInstance.getCenter(),
        zoom: this.mapInstance.getZoom(),
        bearing: this.mapInstance.getBearing(),
        pitch: this.mapInstance.getPitch(),
      })
    })
    this.mapInstance.on('click', e => {
      // Debounce to allow POI click handler to fire first and cancel this
      if (this.clickDebounceTimer) {
        clearTimeout(this.clickDebounceTimer)
      }

      this.clickDebounceTimer = window.setTimeout(() => {
        mapEventBus.emit('click', {
          lngLat: e.lngLat,
          point: e.point,
        })
        this.clickDebounceTimer = null
      }, 50)
    })
    this.mapInstance.on('contextmenu', e => {
      e.preventDefault()
      mapEventBus.emit('contextmenu', {
        lngLat: e.lngLat,
        point: e.point,
      })
    })

    // Touch-and-hold for mobile context menu
    this.setupLongPressHandler()
    this.mapInstance.on('click', 'mapillary-image', e => {
      mapEventBus.emit('click:mapillary-image', {
        lngLat: e.lngLat,
        point: e.point,
        image: (e.features?.[0]?.properties as MapillaryImage) || undefined,
      })
    })
    // Change pointers on hover
    this.mapInstance.on('mouseenter', 'mapillary-image', () => {
      this.mapInstance.getCanvas().style.cursor = 'pointer'
    })
    this.mapInstance.on('mouseleave', 'mapillary-image', () => {
      this.mapInstance.getCanvas().style.cursor = ''
    })
  }

  resize() {
    this.mapInstance.resize()
  }

  flyTo(camera: Partial<CameraOptions>) {
    this.mapInstance.flyTo(camera)
  }

  jumpTo(camera: Partial<CameraOptions>) {
    this.mapInstance.jumpTo(camera)
  }

  fitBounds(
    bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number },
    options: any = {},
  ) {
    const mapboxBounds = new LngLatBounds(
      [bounds.minLng, bounds.minLat],
      [bounds.maxLng, bounds.maxLat],
    )

    this.mapInstance.fitBounds(mapboxBounds, {
      padding: options.padding || 100,
      duration: options.duration || 1000,
      easing: options.easing || (t => t * (2 - t)),
      ...options,
    })
  }

  setDirections(directions: Directions) {
    this.unsetDirections()

    directions.legs.forEach((leg, index) => {
      const shape = decodeShape(leg.shape)

      this.mapInstance.addSource(`route-${index}`, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: shape.map(([lat, lon]) => [lon, lat]),
          },
        },
      })

      this.mapInstance.addLayer({
        id: `route-case-${index}`,
        type: 'line',
        source: `route-${index}`,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': colors.green[600],
          'line-width': 8,
        },
      })

      this.mapInstance.addLayer({
        id: `route-${index}`,
        type: 'line',
        source: `route-${index}`,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': colors.green[400],
          'line-width': 5,
        },
      })
    })

    // Add Vue component markers for each stop instead of circle layers
    directions.locations.forEach((location, index) => {
      this.addVueMarker(
        `route-stop-${index}`,
        { lat: location.lat, lng: location.lon },
        WaypointMapIcon,
        {
          index,
          totalWaypoints: directions.locations.length,
          type:
            index === 0
              ? 'origin'
              : index === directions.locations.length - 1
                ? 'destination'
                : 'waypoint',
        },
      )
    })

    // Get all route coordinates
    const allCoordinates: mapboxgl.LngLatLike[] = directions.legs.flatMap(
      leg => {
        const shape = decodeShape(leg.shape)
        return shape.map(([lat, lon]) => [lon, lat] as mapboxgl.LngLatLike)
      },
    )

    // Create a bounds object that encompasses all coordinates
    const bounds = allCoordinates.reduce(
      (bounds, coord) => {
        return bounds.extend(coord)
      },
      new LngLatBounds(allCoordinates[0], allCoordinates[0]),
    )

    // Fit the map to show the entire route with padding
    this.mapInstance.fitBounds(bounds, {
      padding: Math.min(window.innerWidth * 0.2, 400),
      duration: 400,
      easing: t => t * (2 - t),
      bearing: this.mapInstance.getBearing(), // Preserve current bearing
    })
  }

  unsetDirections() {
    const style = this.mapInstance.getStyle()
    if (!style) return
    const mapLayers = style.layers
    const ids = mapLayers.map(layer => layer.id)

    // Remove route layers
    ids.forEach(id => {
      if (id.startsWith('route-')) {
        this.mapInstance.removeLayer(id)
      }
    })

    // Remove route sources
    const sources = Object.keys(this.mapInstance.getStyle()?.sources || {})
    sources.forEach(source => {
      if (source.startsWith('route-')) {
        this.mapInstance.removeSource(source)
      }
    })

    // Remove route stop markers
    const markersToRemove = Array.from(this.markers.keys()).filter(id =>
      id.startsWith('route-stop-'),
    )
    markersToRemove.forEach(id => this.removeMarker(id))
  }

  setPegman(pegman: Pegman) {
    if (!this.mapInstance.getSource('pegman')) {
      createPegmanLayers(this.mapInstance, false)
    }
    const source = this.mapInstance.getSource('pegman') as GeoJSONSource
    if (source) {
      source.setData(updatePegmanData({ ...pegman, visible: true }))
    }
  }

  removePegman() {
    // Remove pegman layers if they exist
    if (this.mapInstance.getLayer('pegman-fov')) {
      this.mapInstance.removeLayer('pegman-fov')
    }
    if (this.mapInstance.getLayer('pegman-position')) {
      this.mapInstance.removeLayer('pegman-position')
    }
    if (this.mapInstance.getSource('pegman')) {
      this.mapInstance.removeSource('pegman')
    }
  }

  setPoiLabels(value: boolean) {
    this.setLayerGroupVisibility(this.styleConfig.poiLayerIds, value)
  }

  setRoadLabels(value: boolean) {
    this.setLayerGroupVisibility(this.styleConfig.roadLabelLayerIds, value)
  }

  setTransitLabels(value: boolean) {
    this.setLayerGroupVisibility(this.styleConfig.transitLayerIds, value)
  }

  setPlaceLabels(value: boolean) {
    this.setLayerGroupVisibility(this.styleConfig.placeLabelLayerIds, value)
  }

  setMap3dTerrain(_value: boolean) {
    // TODO: Need to find a free 3D DEM source
  }

  setMap3dObjects(value: boolean) {
    const {
      buildingLayerId,
      buildingHeightProperty,
      buildingMinHeightProperty,
    } = this.styleConfig
    if (!buildingLayerId || !this.mapInstance.getLayer(buildingLayerId)) return

    if (value) {
      this.mapInstance.setPaintProperty(
        buildingLayerId,
        'fill-extrusion-height',
        ['coalesce', ['get', buildingHeightProperty], 0],
      )
      this.mapInstance.setPaintProperty(
        buildingLayerId,
        'fill-extrusion-base',
        ['coalesce', ['get', buildingMinHeightProperty], 0],
      )
    } else {
      this.mapInstance.setPaintProperty(
        buildingLayerId,
        'fill-extrusion-height',
        0,
      )
      this.mapInstance.setPaintProperty(
        buildingLayerId,
        'fill-extrusion-base',
        0,
      )
    }
  }

  private setLayerGroupVisibility(layerIds: string[], visible: boolean) {
    layerIds.forEach(id => {
      if (this.mapInstance.getLayer(id)) {
        this.mapInstance.setLayoutProperty(
          id,
          'visibility',
          visible ? 'visible' : 'none',
        )
      }
    })
  }

  getBasemapFromTheme() {
    if (!this.tileServerUrl) {
      // Fallback: minimal empty style when no tile server is configured
      return { version: 8 as const, sources: {}, layers: [] }
    }
    const theme = this.options.theme === 'dark' ? 'dark' : 'light'
    return buildMapStyle({
      tileServerUrl: this.tileServerUrl,
      theme,
      tileKey: this.tileKey,
      mapStyle: this.options.mapStyle,
    })
  }

  setMapTheme(theme: MapTheme) {
    this.options.theme = theme
    this.reloadStyle()
  }

  setBasemap(basemap: Basemap) {
    this.currentBasemap = basemap
    this.reloadStyle()
  }

  setMapStyle(styleId: MapStyleId) {
    this.options.mapStyle = styleId
    this.styleConfig = getStyleConfig(styleId)
    this.reloadStyle()
  }

  /**
   * Swap the map style and fire style.load so downstream services can
   * re-register their custom layers.
   *
   * CRITICAL: we pass `{ diff: false }` to force a full style replacement.
   * MapLibre's default diff mode compares the old style against the new one
   * and issues `removeLayer`/`removeSource` operations for anything that
   * isn't in the new style — which silently wipes every layer we added
   * manually (bicycle, transit, mapillary, …) without firing `style.load`.
   * With `diff: false` a brand-new Style is created, which reliably fires
   * `style.load` and lets our re-registration pipeline run.
   */
  private reloadStyle() {
    this.mapInstance.setStyle(this.buildCurrentStyle(), { diff: false })
  }

  private buildCurrentStyle() {
    if (!this.tileServerUrl) {
      return { version: 8 as const, sources: {}, layers: [] }
    }
    const theme = this.options.theme === 'dark' ? 'dark' : 'light'
    const styleOpts = {
      tileServerUrl: this.tileServerUrl,
      theme: theme as 'light' | 'dark',
      tileKey: this.tileKey,
      mapStyle: this.options.mapStyle,
    }

    switch (this.currentBasemap) {
      case 'satellite':
        return buildSatelliteStyle({ ...styleOpts, hybrid: false })
      case 'hybrid':
        return buildSatelliteStyle({ ...styleOpts, hybrid: true })
      default:
        return buildMapStyle(styleOpts)
    }
  }

  setMapLanguage(locale: string): boolean {
    // TODO: Implement
    return false // MapLibre doesn't require reinitialization
  }

  removeSource(sourceId: string) {
    if (this.mapInstance.getSource(sourceId)) {
      this.mapInstance.removeSource(sourceId)
    }
  }

  addSource(sourceId: string, source: any) {
    try {
      // Remove existing source if it exists to prevent conflicts
      if (this.mapInstance.getSource(sourceId)) {
        this.mapInstance.removeSource(sourceId)
      }
      this.mapInstance.addSource(sourceId, source)
      console.log(`Added source: ${sourceId}`)
    } catch (error) {
      console.error(`Failed to add source ${sourceId}:`, error)
      throw error
    }
  }

  addLayer(layer: Layer, overwrite: boolean = false) {
    const { configuration }: any = mapboxLayerToMaplibreLayer(
      applyThemedStreetViewStyling(layer),
    )

    if (typeof configuration.source === 'object') {
      const sourceId = configuration.source.id
      const existingSource = this.mapInstance.getSource(sourceId)

      if (existingSource) {
        if (overwrite) {
          this.mapInstance.removeSource(sourceId)
          this.mapInstance.addSource(sourceId, configuration.source as any)
        }
      } else {
        this.mapInstance.addSource(sourceId, configuration.source as any)
      }
      configuration.source = sourceId
    }

    if (typeof configuration.source === 'string') {
      const sourceExists = this.mapInstance.getSource(configuration.source)
      if (!sourceExists) {
        return
      }
    }

    const existingLayer = this.mapInstance.getLayer(configuration.id)
    if (existingLayer && overwrite) {
      this.mapInstance.removeLayer(configuration.id)
    }
    if (!existingLayer || overwrite) {
      try {
        this.mapInstance.addLayer({
          ...(configuration as any),
          layout: {
            ...configuration.layout,
            visibility: layer.visible ? 'visible' : 'none',
          },
        })
        if (layer.type === LayerType.STREET_VIEW) {
          this.streetViewLayerIds.add(configuration.id)
        }
      } catch (error) {
        console.error(`Failed to add layer '${configuration.id}':`, error)
      }
    }
  }

  // TODO: Use maplibre Layer['configuration']['id']
  removeLayer(layerId: string) {
    if (this.mapInstance.getLayer(layerId)) {
      this.mapInstance.removeLayer(layerId)
    }
  }

  // TODO: Use maplibre Layer['configuration']['id']
  toggleLayerVisibility(layerId: string, visible: boolean) {
    // Check if layer exists before trying to toggle visibility
    if (!this.mapInstance.getLayer(layerId)) {
      console.warn(
        `Cannot toggle visibility: layer '${layerId}' does not exist in map`,
      )
      return
    }

    this.mapInstance.setLayoutProperty(
      layerId,
      'visibility',
      visible ? 'visible' : 'none',
    )
  }

  zoomIn() {
    this.mapInstance.zoomIn()
  }

  zoomOut() {
    this.mapInstance.zoomOut()
  }

  resetNorth() {
    this.mapInstance.easeTo({
      bearing: 0,
      pitch: 0,
    })
  }

  getBounds() {
    if (!this.mapInstance) return null

    const bounds = this.mapInstance.getBounds()
    if (!bounds) return null

    return {
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
    }
  }

  locate() {
    this.geolocateControl.trigger()
  }

  destroy() {
    try {
      this.poiHandlerCleanup?.()
      this.poiHandlerCleanup = null
      this.unwatchTheme?.()

      // Remove the map instance
      if (this.mapInstance) {
        // Check if the map's canvas still exists before removing
        // This prevents errors when the DOM has already been cleaned up
        const canvas = this.mapInstance.getCanvas()
        if (canvas && canvas.parentElement) {
          this.mapInstance.remove()
        }
      }
    } catch (error) {
      // Silently catch errors during cleanup to prevent console spam
      // The map instance may already be partially destroyed
      console.debug('Map cleanup error (non-critical):', error)
    }
  }

  addMarker(id: string, lngLat: LngLat) {
    this.removeMarker(id) // Remove existing marker if any
    const marker = new Marker({ color: '#2563eb' })
      .setLngLat(lngLat as LngLatLike)
      .addTo(this.mapInstance)
    this.markers.set(id, marker)
  }

  addVueMarker(
    id: string,
    lngLat: LngLat,
    component: Component,
    props: Record<string, any> = {},
    zIndex?: number,
    dragOptions?: {
      onDragEnd: (lngLat: LngLat) => void
      onDrag?: (lngLat: LngLat) => void
    },
  ) {
    super.addVueMarker(id, lngLat, component, props, zIndex, dragOptions)
    this.removeMarker(id)

    const element = createVueMarkerElement(component, props)
    const draggable = !!dragOptions

    const marker = new Marker({
      element,
      anchor: 'center',
      ...(draggable && { draggable: true }),
    })
      .setLngLat(lngLat as LngLatLike)
      .addTo(this.mapInstance)

    if (zIndex !== undefined) {
      const markerElement = marker.getElement()
      if (markerElement) {
        markerElement.style.zIndex = String(zIndex)
      }
    }

    if (draggable && dragOptions) {
      const el = marker.getElement()
      if (el) {
        el.style.cursor = 'move'
      }
      if (dragOptions.onDrag) {
        marker.on('drag', () => {
          const pos = marker.getLngLat()
          dragOptions.onDrag!({ lng: pos.lng, lat: pos.lat })
        })
      }
      marker.on('dragend', () => {
        const pos = marker.getLngLat()
        dragOptions.onDragEnd({ lng: pos.lng, lat: pos.lat })
      })
    }

    this.markers.set(id, marker)
  }

  // Note: Waypoint markers are handled by base MapStrategy class

  setTrips(trips: TripsResponse, visibleTripIds: Set<string>) {
    // Idempotent: if we already show exactly these trips, skip destroy+recreate
    const currentTripIds = new Set(
      [...this.layerGroups.keys()]
        .filter(k => k.startsWith('trip-'))
        .map(k => k.slice('trip-'.length)),
    )
    if (
      currentTripIds.size === visibleTripIds.size &&
      [...visibleTripIds].every(id => currentTripIds.has(id))
    ) {
      return
    }

    for (const groupId of this.layerGroups.keys()) {
      if (groupId.startsWith('trip-')) {
        this.layerGroups.get(groupId)?.destroy()
        this.layerGroups.delete(groupId)
      }
    }

    const visibleTrips: any[] = []
    trips.trips.forEach(trip => {
      if (visibleTripIds.has(trip.id)) {
        const groupId = `trip-${trip.id}`
        const tripGroup = new TripGroup(this, trip)
        this.layerGroups.set(groupId, tripGroup)
        visibleTrips.push(trip)
      }
    })

    if (visibleTripIds.size > 0) {
      this.fitMapToTrips(trips, visibleTripIds)
    }
  }

  unsetTrips() {
    for (const groupId of this.layerGroups.keys()) {
      if (groupId.startsWith('trip-')) {
        this.layerGroups.get(groupId)?.destroy()
        this.layerGroups.delete(groupId)
      }
    }
  }

  setRouteProfile(profile: import('@/lib/route-profile-colors').RouteProfileType | null) {
    for (const [groupId, group] of this.layerGroups.entries()) {
      if (groupId.startsWith('trip-') && group instanceof TripGroup) {
        group.setRouteProfile(profile)
      }
    }
  }

  setSegmentRouteProfile(
    tripId: string,
    segmentIndex: number,
    profile: import('@/lib/route-profile-colors').RouteProfileType | null,
  ) {
    const group = this.layerGroups.get(`trip-${tripId}`)
    if (group instanceof TripGroup) {
      group.setSegmentRouteProfile(segmentIndex, profile)
    }
  }

  private fitMapToTrips(trips: TripsResponse, visibleTripIds: Set<string>) {
    const visibleTrips = trips.trips.filter(trip => visibleTripIds.has(trip.id))
    if (visibleTrips.length === 0) return

    const bounds = new LngLatBounds()

    visibleTrips.forEach(trip => {
      trip.segments.forEach(segment => {
        if (segment.geometry) {
          segment.geometry.forEach(coord => {
            bounds.extend([coord.lng, coord.lat])
          })
        }
      })
    })

    if (!bounds.isEmpty()) {
      // Get the visible map area from app store to calculate proper padding
      const appStore = useAppStore()
      const visibleArea = appStore.visibleMapArea

      // Calculate padding based on the visible map area
      // This ensures the trip routes are centered within the unobstructed area
      const mapWidth = this.container.clientWidth
      const mapHeight = this.container.clientHeight

      let padding:
        | number
        | { left: number; top: number; right: number; bottom: number } = 200 // Increased default padding

      if (mapWidth && mapHeight && visibleArea) {
        // Calculate padding values to center content in the visible area with generous margins
        padding = {
          left: Math.max(150, visibleArea.x + 50),
          top: Math.max(150, visibleArea.y + 50),
          right: Math.max(
            150,
            mapWidth - (visibleArea.x + visibleArea.width) + 50,
          ),
          bottom: Math.max(
            150,
            mapHeight - (visibleArea.y + visibleArea.height) + 50,
          ),
        }
      }

      this.mapInstance.fitBounds(bounds, {
        padding,
        duration: 1000,
      })
    }
  }

  /**
   * POI interaction.
   *
   * Both hover and click handlers are registered once and persist
   * across setStyle() calls. MapLibre's per-layer delegates (mouseenter,
   * mouseleave, click) internally use mousemove + queryRenderedFeatures
   * and call getLayer() on each event to filter to existing layers.
   * This means they automatically adapt when the style changes —
   * old layer IDs return nothing from getLayer() and are skipped,
   * new layer IDs are picked up as soon as they exist.
   *
   * We register delegates for ALL known POI layer IDs across all
   * styles. Only the ones present in the current style will fire.
   */
  private setupPoiHandlers() {
    if (this.poiHandlerCleanup) return
    if (!this.tileServerUrl) return

    // Collect all POI layer IDs from all style configs so delegates
    // work regardless of which style is active.
    const allPoiLayerIds = [
      ...new Set(
        Object.values(styleConfigs).flatMap(c => c.poiLayerIds),
      ),
    ]

    const canvas = this.mapInstance.getCanvas()
    let hoverCount = 0

    const onEnter = () => {
      if (hoverCount++ === 0) canvas.style.cursor = 'pointer'
    }
    const onLeave = () => {
      hoverCount = Math.max(0, hoverCount - 1)
      if (hoverCount === 0) canvas.style.cursor = ''
    }

    const handleClick = (layerEvent: any) => {
      if (useMapToolsStore().activeTool === 'measure') return

      const feature = layerEvent.features?.[0]
      if (!feature?.id) return

      const { osmId, poiType } = parsePlanetilerOsmId(feature.id)
      if (poiType === 'unknown') return

      // Cancel the debounced generic click so we don't double-fire
      if (this.clickDebounceTimer) {
        clearTimeout(this.clickDebounceTimer)
        this.clickDebounceTimer = null
      }

      const poiName = feature.properties?.name
      mapEventBus.emit('click', {
        lngLat: layerEvent.lngLat,
        point: layerEvent.point,
        poi: {
          osmId,
          poiType,
          name: typeof poiName === 'string' ? poiName : undefined,
        },
      })
    }

    for (const id of allPoiLayerIds) {
      this.mapInstance.on('mouseenter', id, onEnter)
      this.mapInstance.on('mouseleave', id, onLeave)
      this.mapInstance.on('click', id, handleClick)
    }

    this.poiHandlerCleanup = () => {
      for (const id of allPoiLayerIds) {
        this.mapInstance.off('mouseenter', id, onEnter)
        this.mapInstance.off('mouseleave', id, onLeave)
        this.mapInstance.off('click', id, handleClick)
      }
      canvas.style.cursor = ''
    }
  }

  private updateStreetViewColors() {
    for (const id of this.streetViewLayerIds) {
      const layer = this.mapInstance.getLayer(id) as any
      if (!layer) continue
      const type = (layer as any).type
      if (type === 'circle') {
        const paint = buildStreetViewPaint({ type: 'circle' })
        this.mapInstance.setPaintProperty(
          id,
          'circle-color',
          paint['circle-color'],
        )
        this.mapInstance.setPaintProperty(
          id,
          'circle-stroke-color',
          paint['circle-stroke-color'],
        )
        this.mapInstance.setPaintProperty(
          id,
          'circle-opacity',
          paint['circle-opacity'],
        )
        this.mapInstance.setPaintProperty(
          id,
          'circle-stroke-opacity',
          paint['circle-stroke-opacity'],
        )
      }
      if (type === 'line') {
        const paint = buildStreetViewPaint({ type: 'line' })
        this.mapInstance.setPaintProperty(id, 'line-color', paint['line-color'])
        this.mapInstance.setPaintProperty(
          id,
          'line-opacity',
          paint['line-opacity'],
        )
      }
    }
  }

  // Note: Instruction point markers are now handled by base MapStrategy class
}
