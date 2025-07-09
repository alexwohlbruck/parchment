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
  MapOptions,
  MapTheme,
  MapillaryImage,
  Pegman,
  PEGMAN_LAYERS,
  MapProjection,
  LngLat,
  Waypoint,
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
import { LayerGroup, TripGroup } from '@/lib/layer-group'
import { Component } from 'vue'
import { createVueMarkerElement } from '@/lib/vue-marker.utils'
import WaypointMapIcon from '@/components/map/WaypointMapIcon.vue'
import { useAppStore } from '@/stores/app.store'

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

export class MapboxStrategy extends MapStrategy {
  mapInstance: MapboxMap
  geolocateControl: GeolocateControl
  layerGroups: Map<string, LayerGroup> = new Map()

  constructor(container, options: MapOptions, accessToken?: string) {
    super(container, options, accessToken)

    const { center, zoom, bearing, pitch } = options.camera || {}

    // TODO: Move to ref
    const projection: Projection['name'] =
      (localStorage.getItem('projection') as Projection['name']) || 'globe'

    this.mapInstance = new MapboxMap({
      accessToken: accessToken || import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
      container,
      style: basemapUrls.standard, //standardStyle as any,
      center: center as LngLatLike,
      bearing,
      pitch,
      zoom,
      attributionControl: false,
      projection: {
        name: projection,
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
        if (!e.feature?.id) return

        const { osmId, poiType } = parseMapboxToOsmId(e.feature.id)
        const coordinates = (e.feature.geometry as any).coordinates
        const center = e.feature.properties?.center

        if (poiType !== 'unknown') {
          // For ways/relations, use center point if available
          const lngLat = center
            ? { lng: center[0], lat: center[1] }
            : { lng: coordinates[0], lat: coordinates[1] }

          mapEventBus.emit('click:poi', {
            osmId,
            poiType,
            lngLat,
            point: e.point,
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

  setMapProjection(projection: MapProjection) {
    this.mapInstance.setProjection(projection)
  }

  setMap3dTerrain(value: boolean) {
    const existingTerrainSource = this.mapInstance.getSource('mapbox-dem')
    if (!existingTerrainSource) {
      this.mapInstance.addSource('mapbox-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.terrain-rgb',
      })
    }
    this.mapInstance.setTerrain({
      source: 'mapbox-dem',
      exaggeration: value ? 1 : 0,
    })
  }

  setMap3dBuildings(value: boolean) {
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

  setBasemap(basemap: Basemap) {
    const url = basemapUrls[basemap]
    this.mapInstance.setStyle(url)
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
    const { configuration } = layer

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

  removeLayer(layerId: Layer['configuration']['id']) {
    try {
      if (this.mapInstance.getLayer(layerId)) {
        this.mapInstance.removeLayer(layerId)
      }
    } catch (error) {
      console.warn(`Failed to remove layer ${layerId}:`, error)
    }
  }

  toggleLayerVisibility(
    layerId: Layer['configuration']['id'],
    visible: boolean,
  ) {
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

  addVueMarker(
    id: string,
    lngLat: LngLat,
    component: Component,
    props: Record<string, any> = {},
  ) {
    super.addVueMarker(id, lngLat, component, props)

    const element = createVueMarkerElement(component, props)

    const marker = new Marker({
      element: element,
    })
      .setLngLat(lngLat)
      .addTo(this.mapInstance)

    this.markers.set(id, marker)
  }

  // Trip visualization methods
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
    trips.trips.forEach(trip => {
      if (visibleTripIds.has(trip.id)) {
        const groupId = `trip-${trip.id}`
        console.log(`Creating new trip group: ${groupId}`)
        const tripGroup = new TripGroup(this, trip)
        this.layerGroups.set(groupId, tripGroup)
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

  // Waypoint marker methods (separate from trip routes)
  setWaypointMarkers(waypoints: Waypoint[]) {
    // Remove existing waypoint markers
    this.clearWaypointMarkers()

    // Add new waypoint markers for all waypoints with coordinates
    waypoints.forEach((waypoint, index) => {
      if (waypoint.lngLat) {
        this.addVueMarker(
          `waypoint-${index}`,
          waypoint.lngLat,
          WaypointMapIcon,
          {
            index,
            totalWaypoints: waypoints.length,
            type:
              index === 0
                ? 'origin'
                : index === waypoints.length - 1
                ? 'destination'
                : 'waypoint',
          },
        )
      }
    })
  }
}
