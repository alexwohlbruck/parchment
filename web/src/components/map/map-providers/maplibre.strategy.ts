import { MapStrategy } from './map.strategy'
import {
  Map,
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
  MapOptions,
  Layer,
  MapCamera,
  Pegman,
  MapillaryImage,
  MapProjection,
  LngLat,
} from '@/types/map.types'

import { Directions, TripsResponse } from '@/types/directions.types'
import { decodeShape } from '@/lib/utils'
import colors from 'tailwindcss/colors'
import { mapEventBus } from '@/lib/eventBus'
import { mapboxLayerToMaplibreLayer } from '@/lib/map.utils'
import { useMapStore } from '@/stores/map.store'
import { createPegmanLayers, updatePegmanData } from '@/lib/pegman.utils'

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

export class MaplibreStrategy extends MapStrategy {
  mapInstance: Map
  geolocateControl: GeolocateControl

  constructor(container, options: MapOptions, accessToken?: string) {
    super(container, options, accessToken)

    const { center, zoom, bearing, pitch } = options.camera || {}

    this.mapInstance = new Map({
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

    // Add markers for each stop
    directions.locations.forEach((location, index) => {
      this.mapInstance.addSource(`stop-${index}`, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: [location.lon, location.lat],
          },
        },
      })

      // Add a larger background circle
      this.mapInstance.addLayer({
        id: `stop-background-${index}`,
        type: 'circle',
        source: `stop-${index}`,
        paint: {
          'circle-radius': 7,
          'circle-color': colors.gray[50],
          'circle-opacity': 1,
          'circle-stroke-width': 1,
          'circle-stroke-color': colors.gray[600],
          'circle-blur': 0.3,
        },
      })
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

    // Remove route and stop layers
    ids.forEach(id => {
      if (id.startsWith('route-') || id.startsWith('stop-')) {
        this.mapInstance.removeLayer(id)
      }
    })

    // Remove route sources
    const sources = Object.keys(this.mapInstance.getStyle()?.sources || {})
    sources.forEach(source => {
      if (source.startsWith('route-') || source.startsWith('stop-')) {
        this.mapInstance.removeSource(source)
      }
    })
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

  setMapProjection(projection: MapProjection) {}

  setMap3dTerrain(value: boolean) {
    // TODO:
  }

  setMap3dBuildings(value: boolean) {
    // TODO:
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
    this.mapInstance.removeSource(sourceId)
  }

  addLayer(layer: Layer, overwrite: boolean = false) {
    const { configuration }: any = mapboxLayerToMaplibreLayer(layer)

    // Handle source if it exists in the configuration
    if (typeof configuration.source === 'object') {
      const sourceId = configuration.source.id
      const existingSource = this.mapInstance.getSource(sourceId)

      if (existingSource) {
        if (overwrite) {
          this.mapInstance.removeSource(sourceId)
          this.mapInstance.addSource(sourceId, configuration.source)
        }
      } else {
        this.mapInstance.addSource(sourceId, configuration.source)
      }

      // Update configuration to use source ID instead of source object
      configuration.source = sourceId
    }

    // Handle layer
    const existingLayer = this.mapInstance.getLayer(configuration.id)
    if (existingLayer && overwrite) {
      this.mapInstance.removeLayer(configuration.id)
    }
    if (!existingLayer || overwrite) {
      this.mapInstance.addLayer({
        ...configuration,
        layout: {
          ...configuration.layout,
          visibility: layer.visible ? 'visible' : 'none',
        },
      })
    }
  }

  // TODO: Use maplibre Layer['configuration']['id']
  removeLayer(layerId: string) {
    this.mapInstance.removeLayer(layerId)
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

  locate() {
    this.geolocateControl.trigger()
  }

  destroy() {
    this.mapInstance?.remove()
  }

  addMarker(id: string, lngLat: LngLat) {
    super.addMarker(id, lngLat)

    const marker = new Marker({
      color: 'hsl(var(--primary))', // Use CSS variable from shadcn theme
    })
      .setLngLat(lngLat)
      .addTo(this.mapInstance)

    this.markers.set(id, marker)
  }

  // Trip visualization methods
  setTrips(trips: TripsResponse, visibleTripIds: Set<string>) {
    this.unsetTrips()

    // Color mapping for different travel modes
    const modeColors = {
      walking: { line: colors.blue[500], case: colors.blue[700] },
      driving: { line: colors.red[500], case: colors.red[700] },
      cycling: { line: colors.green[500], case: colors.green[700] },
      transit: { line: colors.indigo[500], case: colors.indigo[700] },
      motorcycle: { line: colors.orange[500], case: colors.orange[700] },
      truck: { line: colors.gray[600], case: colors.gray[800] },
    }

    trips.trips.forEach((trip, tripIndex) => {
      if (!visibleTripIds.has(trip.id)) return

      // Get color for this trip mode
      const colorScheme = modeColors[trip.mode] || modeColors.driving

      // Extract all coordinates from trip segments
      const allCoordinates: [number, number][] = []
      trip.segments.forEach(segment => {
        if (segment.geometry) {
          segment.geometry.forEach(coord => {
            allCoordinates.push([coord.lng, coord.lat])
          })
        }
      })

      if (allCoordinates.length === 0) return

      // Create source for this trip
      const sourceId = `trip-${trip.id}`
      this.mapInstance.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {
            tripId: trip.id,
            mode: trip.mode,
            vehicleType: trip.vehicleType,
          },
          geometry: {
            type: 'LineString',
            coordinates: allCoordinates,
          },
        },
      })

      // Add route case (outer line)
      this.mapInstance.addLayer({
        id: `trip-case-${trip.id}`,
        type: 'line',
        source: sourceId,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': colorScheme.case,
          'line-width': 8,
          'line-opacity': 0.8,
        },
      })

      // Add route line (inner line)
      this.mapInstance.addLayer({
        id: `trip-line-${trip.id}`,
        type: 'line',
        source: sourceId,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': colorScheme.line,
          'line-width': 5,
          'line-opacity': 0.9,
        },
      })
    })

    // Add waypoint markers
    if (trips.request.waypoints.length > 0) {
      trips.request.waypoints.forEach((waypoint, index) => {
        const sourceId = `trip-waypoint-${index}`
        this.mapInstance.addSource(sourceId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Point',
              coordinates: [waypoint.coordinate.lng, waypoint.coordinate.lat],
            },
          },
        })

        // Add waypoint circle with updated colors
        this.mapInstance.addLayer({
          id: `trip-waypoint-${index}`,
          type: 'circle',
          source: sourceId,
          paint: {
            'circle-radius': 8,
            'circle-color':
              index === 0
                ? colors.blue[400] // Light blue for origin
                : index === trips.request.waypoints.length - 1
                ? colors.blue[600] // Mid blue for destination
                : colors.blue[500], // Blue for intermediate waypoints
            'circle-opacity': index === 0 ? 0.7 : 1, // Lighter opacity for origin
            'circle-stroke-width': 2,
            'circle-stroke-color': colors.white,
          },
        })

        // Add waypoint label (numbers for all stops except origin)
        if (index > 0) {
          this.mapInstance.addLayer({
            id: `trip-waypoint-label-${index}`,
            type: 'symbol',
            source: sourceId,
            layout: {
              'text-field': index.toString(), // Numbers for all waypoints except origin (1, 2, 3...)
              'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
              'text-size': 12,
              'text-anchor': 'center',
            },
            paint: {
              'text-color': colors.white,
            },
          })
        }
      })
    }

    // Fit map to show all visible trips
    this.fitMapToTrips(trips, visibleTripIds)
  }

  unsetTrips() {
    const style = this.mapInstance.getStyle()
    if (!style) return

    // Remove all trip-related layers and sources
    const mapLayers = style.layers
    const layerIds = mapLayers.map(layer => layer.id)

    layerIds.forEach(id => {
      if (id.startsWith('trip-')) {
        this.mapInstance.removeLayer(id)
      }
    })

    // Remove trip sources
    const sources = Object.keys(this.mapInstance.getStyle()?.sources || {})
    sources.forEach(source => {
      if (source.startsWith('trip-')) {
        this.mapInstance.removeSource(source)
      }
    })
  }

  updateTripVisibility(tripId: string, visible: boolean) {
    // Update layer visibility
    const caseLayerId = `trip-case-${tripId}`
    const lineLayerId = `trip-line-${tripId}`

    if (this.mapInstance.getLayer(caseLayerId)) {
      this.mapInstance.setLayoutProperty(
        caseLayerId,
        'visibility',
        visible ? 'visible' : 'none',
      )
    }

    if (this.mapInstance.getLayer(lineLayerId)) {
      this.mapInstance.setLayoutProperty(
        lineLayerId,
        'visibility',
        visible ? 'visible' : 'none',
      )
    }
  }

  private fitMapToTrips(trips: TripsResponse, visibleTripIds: Set<string>) {
    // Collect all coordinates from visible trips
    const allCoordinates: [number, number][] = []

    trips.trips.forEach(trip => {
      if (!visibleTripIds.has(trip.id)) return

      trip.segments.forEach(segment => {
        if (segment.geometry) {
          segment.geometry.forEach(coord => {
            allCoordinates.push([coord.lng, coord.lat])
          })
        }
      })
    })

    // Add waypoint coordinates
    trips.request.waypoints.forEach(waypoint => {
      allCoordinates.push([waypoint.coordinate.lng, waypoint.coordinate.lat])
    })

    if (allCoordinates.length === 0) return

    // Create bounds from all coordinates
    const bounds = allCoordinates.reduce((bounds, coord) => {
      return bounds.extend(coord as LngLatLike)
    }, new LngLatBounds(allCoordinates[0] as LngLatLike, allCoordinates[0] as LngLatLike))

    // Fit the map to show all trips with padding
    this.mapInstance.fitBounds(bounds, {
      padding: Math.min(window.innerWidth * 0.15, 300),
      duration: 400,
      easing: t => t * (2 - t),
    })
  }
}
