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
import { mapboxLayerToMaplibreLayer } from '@/lib/map.utils'
import { useMapStore } from '@/stores/map.store'
import { createPegmanLayers, updatePegmanData } from '@/lib/pegman.utils'
import { MapLayerGroup, TripGroup } from '@/lib/layer-group'
import { Component, watch } from 'vue'
import { createVueMarkerElement } from '@/lib/vue-marker.utils'
import WaypointMapIcon from '@/components/map/WaypointMapIcon.vue'
import InstructionPointMarker from '@/components/map/InstructionPointMarker.vue'
import { useAppStore } from '@/stores/app.store'
import { useThemeStore } from '@/stores/theme.store'

const basemapUrls = {
  light: `https://api.maptiler.com/maps/streets-v2/style.json?key=${
    import.meta.env.VITE_MAPTILER_API_KEY
  }`,
  dark: `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${
    import.meta.env.VITE_MAPTILER_API_KEY
  }`,
  hybrid: `https://api.maptiler.com/maps/hybrid/style.json?key=${
    import.meta.env.VITE_MAPTILER_API_KEY
  }`,
  satellite: `https://api.maptiler.com/maps/satellite/style.json?key=${
    import.meta.env.VITE_MAPTILER_API_KEY
  }`,
}

function rgbToHex(rgb: string): string {
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
  if (!m) return '#04CB63'
  const r = Number(m[1]).toString(16).padStart(2, '0')
  const g = Number(m[2]).toString(16).padStart(2, '0')
  const b = Number(m[3]).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}
function hexToHsl(hex: string) {
  hex = hex.replace('#', '')
  const bigint = parseInt(hex, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  const rP = r / 255
  const gP = g / 255
  const bP = b / 255
  const max = Math.max(rP, gP, bP)
  const min = Math.min(rP, gP, bP)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rP:
        h = (gP - bP) / d + (gP < bP ? 6 : 0)
        break
      case gP:
        h = (bP - rP) / d + 2
        break
      case bP:
        h = (rP - gP) / d + 4
        break
    }
    h /= 6
  }
  return { h: h * 360, s: s * 100, l: l * 100 }
}
function hslToHex(h: number, s: number, l: number) {
  h /= 360
  s /= 100
  l /= 100
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  let r: number, g: number, b: number
  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  const toHex = (x: number) => {
    const v = Math.round(x * 255)
    return v.toString(16).padStart(2, '0')
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}
function adjustLightness(hex: string, delta: number) {
  const { h, s, l } = hexToHsl(hex)
  const newL = Math.max(0, Math.min(100, l + delta))
  return hslToHex(h, s, newL)
}
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

  constructor(container, options: MapSettings, accessToken?: string) {
    super(container, options, accessToken)

    const { center, zoom, bearing, pitch } = options.camera || {}

    this.mapInstance = new MaplibreMap({
      container,
      style: this.getBasemapFromTheme(),
      center: center as LngLatLike,
      bearing,
      pitch,
      zoom,
      attributionControl: false,
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
      mapEventBus.emit('click', {
        lngLat: e.lngLat,
        point: e.point,
      })
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
    const bounds = allCoordinates.reduce((bounds, coord) => {
      return bounds.extend(coord)
    }, new LngLatBounds(allCoordinates[0], allCoordinates[0]))

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
    // TODO: Rework this
    const poiLayers = this.mapInstance.getStyle().layers.filter(layer => {
      return (
        layer.id.includes('poi') ||
        layer.id.includes('point_of_interest') ||
        layer.id.includes('place')
      )
    })

    poiLayers.forEach(layer => {
      this.mapInstance.setLayoutProperty(
        layer.id,
        'visibility',
        value ? 'visible' : 'none',
      )
    })
  }

  setRoadLabels(value: boolean) {
    // TODO: Rework this
    const roadLabelLayers = this.mapInstance.getStyle().layers.filter(layer => {
      return (
        layer.id.includes('road-label') ||
        layer.id.includes('road-name') ||
        layer.id.includes('road-number')
      )
    })

    roadLabelLayers.forEach(layer => {
      this.mapInstance.setLayoutProperty(
        layer.id,
        'visibility',
        value ? 'visible' : 'none',
      )
    })
  }

  setTransitLabels(value: boolean) {
    // TODO: Rework this
    const transitLayers = this.mapInstance.getStyle().layers.filter(layer => {
      return (
        layer.id.includes('transit') ||
        layer.id.includes('railway') ||
        layer.id.includes('subway') ||
        layer.id.includes('bus') ||
        layer.id.includes('airport')
      )
    })

    transitLayers.forEach(layer => {
      this.mapInstance.setLayoutProperty(
        layer.id,
        'visibility',
        value ? 'visible' : 'none',
      )
    })
  }

  setPlaceLabels(value: boolean) {
    // TODO: Rework this
    const placeLayers = this.mapInstance.getStyle().layers.filter(layer => {
      return (
        layer.id.includes('place-label') ||
        layer.id.includes('country-label') ||
        layer.id.includes('state-label') ||
        layer.id.includes('settlement-label') ||
        layer.id.includes('city-label')
      )
    })

    placeLayers.forEach(layer => {
      this.mapInstance.setLayoutProperty(
        layer.id,
        'visibility',
        value ? 'visible' : 'none',
      )
    })
  }

  setMap3dTerrain(value: boolean) {
    // TODO: Need to find a free 3D DEM source
  }

  setMap3dObjects(value: boolean) {
    const buildingsLayerId = 'Building 3D'
    const buildingsLayer = this.mapInstance.getLayer(buildingsLayerId)
    if (!buildingsLayer) {
      return
    }
    if (value) {
      this.mapInstance.setPaintProperty(
        buildingsLayerId,
        'fill-extrusion-height',
        ['get', 'render_height'],
      )
      this.mapInstance.setPaintProperty(
        buildingsLayerId,
        'fill-extrusion-base',
        ['get', 'render_min_height'],
      )
    } else {
      this.mapInstance.setPaintProperty(
        buildingsLayerId,
        'fill-extrusion-height',
        0,
      )
      this.mapInstance.setPaintProperty(
        buildingsLayerId,
        'fill-extrusion-base',
        0,
      )
    }
  }

  getBasemapFromTheme() {
    return this.options.theme === 'dark' ? basemapUrls.dark : basemapUrls.light
  }

  setMapTheme(theme: MapTheme) {
    this.options.theme = theme
    this.mapInstance.setStyle(this.getBasemapFromTheme())
  }

  setBasemap(basemap: Basemap) {
    const themeMap: {
      [key in Basemap]: string
    } = {
      standard: this.getBasemapFromTheme(),
      satellite: basemapUrls.satellite,
      hybrid: basemapUrls.hybrid,
    }
    this.mapInstance.setStyle(themeMap[basemap])
  }

  removeSource(sourceId: string) {
    try {
      if (this.mapInstance.getSource(sourceId)) {
        this.mapInstance.removeSource(sourceId)
      }
    } catch (error) {
      console.warn(`Failed to remove source ${sourceId}:`, error)
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

    try {
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
      }
    } catch (error) {
      // Silent error handling
    }
  }

  // TODO: Use maplibre Layer['configuration']['id']
  removeLayer(layerId: string) {
    try {
      if (this.mapInstance.getLayer(layerId)) {
        this.mapInstance.removeLayer(layerId)
      }
    } catch (error) {
      console.warn(`Failed to remove layer ${layerId}:`, error)
    }
  }

  // TODO: Use maplibre Layer['configuration']['id']
  toggleLayerVisibility(layerId: string, visible: boolean) {
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
    this.mapInstance?.remove()
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
  ) {
    super.addVueMarker(id, lngLat, component, props, zIndex)

    const element = createVueMarkerElement(component, props)

    const marker = new Marker({
      element: element,
      anchor: 'center', // Center the element on the position
    })
      .setLngLat(lngLat as LngLatLike)
      .addTo(this.mapInstance)

    // Set z-index on the marker's DOM element if provided
    if (zIndex !== undefined) {
      const markerElement = marker.getElement()
      if (markerElement) {
        markerElement.style.zIndex = String(zIndex)
      }
    }

    this.markers.set(id, marker)
  }

  // Note: Waypoint markers are handled by base MapStrategy class

  setTrips(trips: TripsResponse, visibleTripIds: Set<string>) {
    console.log(
      `Setting trips: visible=${Array.from(visibleTripIds).join(', ')}`,
    )

    // ALWAYS destroy ALL existing trip groups to ensure complete cleanup
    for (const groupId of this.layerGroups.keys()) {
      if (groupId.startsWith('trip-')) {
        console.log(`Destroying existing trip group: ${groupId}`)
        this.layerGroups.get(groupId)?.destroy()
        this.layerGroups.delete(groupId)
      }
    }

    // Create fresh trip groups for visible trips
    const visibleTrips: any[] = []
    trips.trips.forEach(trip => {
      if (visibleTripIds.has(trip.id)) {
        const groupId = `trip-${trip.id}`
        console.log(`Creating new trip group: ${groupId}`)
        const tripGroup = new TripGroup(this, trip)
        this.layerGroups.set(groupId, tripGroup)
        visibleTrips.push(trip)
      }
    })

    // Only fit map to trips if there are visible trips
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
