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

import { Directions } from '@/types/directions.types'
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

  constructor(container, options: MapOptions) {
    super(container, options)

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
    this.addControls()
    this.configureEventListeners()
  }

  addControls() {
    this.mapInstance.addControl(new ScaleControl({}), 'top-left')
    this.mapInstance.addControl(new NavigationControl({}), 'top-right')
    this.mapInstance.addControl(new GeolocateControl({}), 'top-right')
    this.mapInstance.addControl(
      new AttributionControl({
        compact: true,
      }),
      'bottom-left',
    )
  }

  configureEventListeners() {
    this.mapInstance.on('load', () => {
      mapEventBus.emit('load', this.mapInstance)
    })
    this.mapInstance.on('style.load', () => {
      mapEventBus.emit('style.load', this.mapInstance)
      this.setMapTheme(this.options.theme)
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

  // TODO: Get maplibre layer type
  addLayer(layer: Layer, overwrite: boolean = false) {
    const { configuration }: any = mapboxLayerToMaplibreLayer(layer)
    const existingLayer = this.mapInstance.getLayer(layer.configuration.id)
    if (existingLayer && overwrite) {
      this.mapInstance.removeLayer(layer.configuration.id)
    }
    if (!existingLayer) {
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
