import { MapStrategy } from './map.strategy'
import {
  Map as MapboxMap,
  NavigationControl,
  GeolocateControl,
  AttributionControl,
  ScaleControl,
  Projection,
  Marker,
  LngLatBounds,
  LngLatLike,
  GeoJSONSource,
  LngLat as MapboxLngLat,
  CameraOptions,
} from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import {
  Basemap,
  Layer,
  MapCamera,
  MapSettings,
  MapTheme,
  MapColorTheme,
  MapillaryImage,
  Pegman,
  PEGMAN_LAYERS,
  MapProjection,
  LngLat,
  Waypoint,
  LayerType,
} from '@/types/map.types'
import standardStyle from '@/components/map/styles/standard.json'

import { Directions, TripsResponse } from '@/types/directions.types'
import { decodeShape } from '@/lib/utils'
import colors from 'tailwindcss/colors'
import { mapEventBus } from '@/lib/eventBus'
import { createPegmanLayers, updatePegmanData } from '@/lib/pegman.utils'
import { parseMapboxToOsmId } from '@/lib/map.utils'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { MapLayerGroup, TripGroup } from '@/lib/layer-group'
import { Component, watch } from 'vue'
import { createVueMarkerElement } from '@/lib/vue-marker.utils'
import WaypointMapIcon from '@/components/map/WaypointMapIcon.vue'
import InstructionPointMarker from '@/components/map/InstructionPointMarker.vue'
import { useAppStore } from '@/stores/app.store'
import { useThemeStore } from '@/stores/theme.store'
import { useMapToolsStore } from '@/stores/map-tools.store'
import { getPrimaryThemeHex, adjustLightness, cssHslToHex } from '@/lib/utils'

const basemapUrls: {
  [key in Basemap]: string
} = {
  // standard: standardStyle as any,
  standard: 'mapbox://styles/mapbox/standard',
  hybrid: 'mapbox://styles/mapbox/satellite-streets-v11',
  satellite: 'mapbox://styles/mapbox/satellite-v9',
}

declare module 'mapbox-gl' {
  interface Map {
    setConfigProperty: (
      importId: string,
      configName: string,
      value: any,
    ) => this
  }
}

// Guard decorator to ensure the basemap is loaded
function ifBasemapLoaded(target, name, descriptor) {
  const original = descriptor.value
  descriptor.value = function (...args) {
    if (
      this.mapInstance.style.fragments?.some((f: any) => f.id === 'basemap')
    ) {
      original.apply(this, args)
    }
  }
  return descriptor
}

function buildStreetViewPaint(configuration: any) {
  const primary = getPrimaryThemeHex()
  const fill = adjustLightness(primary, 8) // brighter fill
  const stroke = adjustLightness(primary, -18) // darker outline for contrast

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

export class MapboxStrategy extends MapStrategy {
  mapInstance: MapboxMap
  private streetViewLayerIds: Set<string> = new Set()
  private unwatchTheme?: () => void
  private clickDebounceTimer: number | null = null
  geolocateControl: GeolocateControl
  layerGroups: Map<string, MapLayerGroup> = new Map()
  private currentLanguage?: string
  private hdRoadsEnabled: boolean = false

  constructor(
    container,
    options: MapSettings,
    accessToken?: string,
    language?: string,
  ) {
    super(container, options, accessToken)

    const { center, zoom, bearing, pitch } = options.camera || {}
    const { projection } = options

    // Store the current language
    this.currentLanguage = language

    // Detect if running in automated test environment
    const isTestEnvironment = 
      import.meta.env.MODE === 'test' || 
      (typeof navigator !== 'undefined' && navigator.webdriver) ||
      (typeof window !== 'undefined' && (window as any).__playwright)
    
    this.mapInstance = new MapboxMap({
      accessToken: accessToken || import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
      container,
      style: basemapUrls[options.basemap || 'standard'],
      language: language, // Set language during initialization for Standard style
      center: center as LngLatLike,
      bearing,
      pitch,
      zoom,
      attributionControl: false,
      projection: {
        name: projection,
      },
      // Enable test mode for automated tests (Playwright, etc.)
      // This prevents API calls and WebGL rendering issues in headless browsers
      testMode: isTestEnvironment,
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

    // Watch theme changes and update street view layers dynamically
    const theme = useThemeStore()
    this.unwatchTheme = watch(
      () => theme.accentColor,
      () => {
        this.updateStreetViewColors()
      },
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
    this.mapInstance.on('style.load', () => {
      mapEventBus.emit('style.load', this.mapInstance)
      this.setMapTheme(this.options.theme)
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
      // Debounce to allow POI interaction to fire first
      if (this.clickDebounceTimer) {
        clearTimeout(this.clickDebounceTimer)
      }

      this.clickDebounceTimer = window.setTimeout(() => {
        // Emit regular click without POI data
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
    // TODO: This is a bad spot for this
    this.mapInstance.addInteraction('mapillary-mouseenter', {
      type: 'mouseenter',
      target: { layerId: 'mapillary-image' },
      handler: () => {
        this.mapInstance.getCanvas().style.cursor = 'pointer'
      },
    })
    this.mapInstance.addInteraction('mapillary-mouseleave', {
      type: 'mouseleave',
      target: { layerId: 'mapillary-image' },
      handler: () => {
        this.mapInstance.getCanvas().style.cursor = ''
      },
    })
    this.listenPOIClick()
  }

  listenPOIClick() {
    this.mapInstance.addInteraction('poi-mouseenter', {
      type: 'mouseenter',
      target: { featuresetId: 'poi', importId: 'basemap' },
      handler: e => {
        this.mapInstance.getCanvas().style.cursor = 'pointer'
      },
    })

    this.mapInstance.addInteraction('poi-mouseleave', {
      type: 'mouseleave',
      target: { featuresetId: 'poi', importId: 'basemap' },
      handler: e => {
        this.mapInstance.getCanvas().style.cursor = ''
      },
    })

    this.mapInstance.addInteraction('poi-click', {
      type: 'click',
      target: { featuresetId: 'poi', importId: 'basemap' },
      handler: e => {
        // When measure tool is active, ignore POI clicks so the debounced map click
        // fires and the click is treated as a regular map click (add measure point).
        if (useMapToolsStore().activeTool === 'measure') return
        if (!e.feature?.id) return

        const { osmId, poiType } = parseMapboxToOsmId(e.feature.id)
        const coordinates = (e.feature.geometry as any).coordinates
        const center = e.feature.properties?.center

        if (poiType !== 'unknown') {
          // Cancel the debounced regular click
          if (this.clickDebounceTimer) {
            clearTimeout(this.clickDebounceTimer)
            this.clickDebounceTimer = null
          }

          // For ways/relations, use center point if available
          const lngLat = center
            ? { lng: center[0], lat: center[1] }
            : { lng: coordinates[0], lat: coordinates[1] }

          // Emit unified click event with POI data
          const poiName = e.feature.properties?.name
          mapEventBus.emit('click', {
            lngLat,
            point: e.point,
            poi: {
              osmId,
              poiType,
              name: typeof poiName === 'string' ? poiName : undefined,
            },
          })
        }
      },
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
          'line-emissive-strength': 1,
        },
        slot: 'middle',
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
          'line-emissive-strength': 1,
        },
        slot: 'middle',
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
      createPegmanLayers(this.mapInstance, true)
    }

    const source = this.mapInstance.getSource('pegman') as GeoJSONSource
    if (source) {
      source.setData(updatePegmanData({ ...pegman, visible: true }))
    }
  }

  removePegman() {
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
    this.mapInstance.setConfigProperty(
      'basemap',
      'showPointOfInterestLabels',
      value,
    )
  }

  setRoadLabels(value: boolean) {
    this.mapInstance.setConfigProperty('basemap', 'showRoadLabels', value)
  }

  setTransitLabels(value: boolean) {
    this.mapInstance.setConfigProperty('basemap', 'showTransitLabels', value)
  }

  setPlaceLabels(value: boolean) {
    this.mapInstance.setConfigProperty('basemap', 'showPlaceLabels', value)
  }

  setLandmarkIcons(value: boolean) {
    this.mapInstance.setConfigProperty('basemap', 'showLandmarkIcons', value)
    this.mapInstance.setConfigProperty(
      'basemap',
      'showLandmarkIconLabels',
      value,
    )
  }

  setMapProjection(projection: MapProjection) {
    this.mapInstance.setProjection(projection)
  }

  setMap3dTerrain(value: boolean) {
    const existingTerrainSource = this.mapInstance.getSource('mapbox-dem')

    if (value && !existingTerrainSource) {
      this.mapInstance.addSource('mapbox-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.terrain-rgb',
      })
      this.mapInstance.setTerrain({
        source: 'mapbox-dem',
        exaggeration: value ? 1 : 0,
      })
    } else if (!value && existingTerrainSource) {
      this.mapInstance.setTerrain()
      this.mapInstance.removeSource('mapbox-dem')
    }
  }

  setMap3dObjects(value: boolean) {
    this.mapInstance.setConfigProperty('basemap', 'show3dObjects', value)
  }

  @ifBasemapLoaded
  setMapTheme(theme: MapTheme) {
    const themeMap: { [key in MapTheme]: string } = {
      [MapTheme.LIGHT]: 'day',
      [MapTheme.DARK]: 'night',
    }
    const lightPreset = themeMap[theme]
    this.mapInstance.setConfigProperty('basemap', 'lightPreset', lightPreset)
  }

  setMapColorTheme(theme: MapColorTheme) {
    this.mapInstance.setConfigProperty('basemap', 'theme', theme)
  }

  setHdRoads(value: boolean) {
    if (this.hdRoadsEnabled === value) {
      return // No change needed
    }

    this.hdRoadsEnabled = value

    if (value) {
      // Add HD roads import
      // The addImport method takes an ImportSpecification object
      this.mapInstance.addImport({
        id: 'hd-roads',
        url: 'mapbox://styles/mapbox/high-definition-roads',
        config: {},
      })
    } else {
      // Remove HD roads import
      this.mapInstance.removeImport('hd-roads')
    }
  }

  setBasemap(basemap: Basemap) {
    const url = basemapUrls[basemap]
    this.mapInstance.setStyle(url)
  }

  setMapLanguage(locale: string): boolean {
    // Convert locale to language code for map tiles (e.g., 'en-US' -> 'en', 'es-ES' -> 'es')
    const languageCode = locale.split('-')[0]

    // Check if language is already set
    if (this.currentLanguage === languageCode) {
      return false // No change needed
    }

    // For Mapbox (both Standard and legacy styles), language must be set during initialization
    // Return true to indicate that map needs to be reinitialized
    return true
  }

  removeSource(sourceId: string) {
    if (this.mapInstance.getSource(sourceId)) {
      this.mapInstance.removeSource(sourceId)
    }
  }

  addSource(sourceId: string, source: any) {
    try {
      // Check if style is loaded before adding source
      if (!this.mapInstance.isStyleLoaded()) {
        this.mapInstance.once('style.load', () => {
          this.addSource(sourceId, source)
        })
        return
      }

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
    const themedLayer = applyThemedStreetViewStyling(layer)
    const { configuration } = themedLayer

    // Handle source if it exists in the configuration
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

      // Update configuration to use source ID instead of source object
      configuration.source = sourceId
    }

    // Verify source exists before adding layer
    if (typeof configuration.source === 'string') {
      const sourceExists = this.mapInstance.getSource(configuration.source)
      if (!sourceExists) {
        console.warn(
          `Cannot add layer ${configuration.id}: source '${configuration.source}' does not exist`,
        )
        return
      }
    }

    // Handle layer
    const existingLayer = this.mapInstance.getLayer(configuration.id)
    if (existingLayer && overwrite) {
      this.mapInstance.removeLayer(configuration.id)
    }
    if (!existingLayer || overwrite) {
      this.mapInstance.addLayer({
        ...(configuration as any),
        layout: {
          ...configuration.layout,
          visibility: themedLayer.visible ? 'visible' : 'none',
        },
      })

      // Track street view layer ids for live theme updates
      if (themedLayer.type === LayerType.STREET_VIEW) {
        this.streetViewLayerIds.add(configuration.id)
      }
    }
  }

  removeLayer(layerId: Layer['configuration']['id']) {
    if (this.mapInstance.getLayer(layerId)) {
      this.mapInstance.removeLayer(layerId)
    }
  }

  toggleLayerVisibility(
    layerId: Layer['configuration']['id'],
    visible: boolean,
  ) {
    // Check if layer exists before trying to toggle visibility
    if (!this.mapInstance.getLayer(layerId)) {
      console.warn(`Cannot toggle visibility: layer '${layerId}' does not exist in map`)
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
    // Clean up theme watcher
    if (this.unwatchTheme) {
      this.unwatchTheme()
      this.unwatchTheme = undefined
    }

    // Remove the map instance
    if (this.mapInstance) {
      const canvas = this.mapInstance.getCanvas()
      if (canvas && canvas.parentElement) {
        this.mapInstance.remove()
      }
    }
  }

  addMarker(id: string, lngLat: LngLat) {
    super.addMarker(id, lngLat)

    const marker = new Marker({
      color: cssHslToHex('hsl(var(--primary))'), // Convert CSS variable to hex color
    })
      .setLngLat(lngLat)
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
      .setLngLat(lngLat)
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
        el.style.cursor = 'grab'
        marker.on('dragstart', () => {
          el.style.cursor = 'grabbing'
        })
      }
      if (dragOptions.onDrag) {
        marker.on('drag', () => {
          const pos = marker.getLngLat()
          dragOptions.onDrag!({ lng: pos.lng, lat: pos.lat })
        })
      }
      marker.on('dragend', () => {
        if (el) el.style.cursor = 'grab'
        const pos = marker.getLngLat()
        dragOptions.onDragEnd({ lng: pos.lng, lat: pos.lat })
      })
    }

    this.markers.set(id, marker)
  }

  // Trip visualization methods
  setTrips(trips: TripsResponse, visibleTripIds: Set<string>) {
    // Idempotent: if we already show exactly these trips, skip destroy+recreate to avoid route flicker from double-calls (e.g. TripDetail watch + onMounted)
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

    // Destroy ALL existing trip groups
    for (const groupId of this.layerGroups.keys()) {
      if (groupId.startsWith('trip-')) {
        this.layerGroups.get(groupId)?.destroy()
        this.layerGroups.delete(groupId)
      }
    }

    // Create fresh trip groups for visible trips
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

  // Note: Waypoint and instruction point markers are now handled by base MapStrategy class

  private updateStreetViewColors() {
    const primary = getPrimaryThemeHex()
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
          'circle-stroke-opacity',
          paint['circle-stroke-opacity'],
        )
        this.mapInstance.setPaintProperty(
          id,
          'circle-opacity',
          paint['circle-opacity'],
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
}
