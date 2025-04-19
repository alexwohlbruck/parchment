import { MapStrategy } from './map.strategy'
import {
  Map,
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
} from '@/types/map.types'
import standardStyle from '@/components/map/styles/standard.json'

import { Directions } from '@/types/directions.types'
import { decodeShape } from '@/lib/utils'
import colors from 'tailwindcss/colors'
import { mapEventBus } from '@/lib/eventBus'
import { createPegmanLayers, updatePegmanData } from '@/lib/pegman.utils'
import { parseMapboxToOsmId } from '@/lib/map.utils'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'

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
  mapInstance: Map
  geolocateControl: GeolocateControl

  constructor(container, options: MapOptions) {
    super(container, options)

    const { center, zoom, bearing, pitch } = options.camera || {}

    // TODO: Move to ref
    const projection: Projection['name'] =
      (localStorage.getItem('projection') as Projection['name']) || 'globe'

    this.mapInstance = new Map({
      accessToken: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
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
          'circle-emissive-strength': 1,
        },
        slot: 'middle',
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
    this.mapInstance.removeSource(sourceId)
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
    this.mapInstance.removeLayer(layerId)
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
}
