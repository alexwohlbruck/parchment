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
} from '@/types/map.types'
import standardStyle from '@/components/map/styles/standard.json'

import { Directions } from '@/types/directions.types'
import { decodeShape } from '@/lib/utils'
import colors from 'tailwindcss/colors'
import { mapEventBus } from '@/lib/eventBus'
import { createPegmanLayers, updatePegmanData } from '@/lib/pegman.utils'

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

  constructor(container, options: MapOptions) {
    super(container, options)

    const { center, zoom, bearing, pitch } = options.camera || {}

    // TODO: Move to ref
    const projection: Projection['name'] =
      (localStorage.getItem('projection') as Projection['name']) || 'globe'

    this.mapInstance = new Map({
      accessToken: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
      container,
      style: standardStyle as any,
      center: center as LngLatLike,
      bearing,
      pitch,
      zoom,
      attributionControl: false,
      projection: {
        name: projection,
      },
    })
    this.addControls()
    this.configureEventListeners()
  }

  addControls() {
    this.mapInstance.addControl(new ScaleControl(), 'top-left')
    this.mapInstance.addControl(new NavigationControl(), 'top-right')
    this.mapInstance.addControl(new GeolocateControl(), 'top-right')
    this.mapInstance.addControl(
      new AttributionControl({
        compact: true,
      }),
      'top-left',
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
    // TODO: This is a bad spot for this
    this.mapInstance.on('mouseenter', 'mapillary-image', () => {
      this.mapInstance.getCanvas().style.cursor = 'pointer'
    })
    this.mapInstance.on('mouseleave', 'mapillary-image', () => {
      this.mapInstance.getCanvas().style.cursor = ''
    })
  }

  // TODO:
  listenPOIClick() {
    let selectedBuildings = []
    this.mapInstance.addInteraction('building-click', {
      type: 'click',
      target: { featuresetId: 'buildings', importId: 'basemap' },
      handler: e => {
        console.log(e.feature)
        // this.mapInstance.setFeatureState(e.feature, { select: !e.feature.state.select })
        // selectedBuildings.push(e.feature)
      },
    })

    // TODO: Handle POI Clicks
    // Watching this discussion: https://github.com/mapbox/mapbox-gl-js/issues/13332#issuecomment-2545008324
    let selectedPoi = null
    const poiMarker = new Marker({ color: 'red' })
    poiMarker.getElement().style.cursor = 'pointer'
    this.mapInstance.addInteraction('poi-click', {
      type: 'click',
      target: { featuresetId: 'poi', importId: 'basemap' },
      handler: e => {
        console.log(e.feature)
      },
    })
  }

  resize() {
    this.mapInstance.resize()
  }

  flyTo(camera: Partial<MapCamera>) {
    this.mapInstance.flyTo(camera)
  }

  jumpTo(camera: Partial<MapCamera>) {
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

  togglePoiLabels(value: boolean) {
    this.mapInstance.setConfigProperty(
      'basemap',
      'showPointOfInterestLabels',
      value,
    )
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

  removeLayer(layerId: Layer['configuration']['id']) {
    this.mapInstance.removeLayer(layerId)
  }

  toggleLayerVisibility(
    layerId: Layer['configuration']['id'],
    visible: boolean,
  ) {
    console.log(this.mapInstance.getLayer(layerId))
    this.mapInstance.setLayoutProperty(
      layerId,
      'visibility',
      visible ? 'visible' : 'none',
    )
  }

  destroy() {
    this.mapInstance.remove()
  }
}
