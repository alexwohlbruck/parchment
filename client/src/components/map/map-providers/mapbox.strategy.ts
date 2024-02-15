import { MapStrategy } from './map.strategy'
import {
  Map,
  NavigationControl,
  GeolocateControl,
  AttributionControl,
  ScaleControl,
  Projection,
} from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { Basemap, MapOptions, type MapTheme } from '@/types/map.types'

import { layers } from '../layers' // TODO: Refactor layers init

const basemapUrls: {
  [key in Basemap]: string
} = {
  standard: 'mapbox://styles/mapbox/standard-beta',
  hybrid: 'mapbox://styles/mapbox/satellite-streets-v11',
  satellite: 'mapbox://styles/mapbox/satellite-v9',
}

declare module 'mapbox-gl' {
  interface Map {
    setConfigProperty: (namespace: string, key: string, value: any) => void
  }
}

// Guard decorator to ensure the basemap is loaded
function ifBasemapLoaded(target, name, descriptor) {
  const original = descriptor.value
  descriptor.value = function (...args) {
    if (this.map.style.fragments?.some((f: any) => f.id === 'basemap')) {
      original.apply(this, args)
    }
  }
  return descriptor
}

export class MapboxStrategy extends MapStrategy {
  // instance of mapbox `Map`
  map: Map

  constructor(container, options?: Partial<MapOptions>) {
    super(container, options)

    // For testing
    const { lng, lat, zoom, bearing, pitch } = {
      lng: -80.8432808,
      lat: 35.2205601,
      bearing: 0,
      pitch: 0,
      zoom: 14,
    }
    const projection: Projection['name'] =
      (localStorage.getItem('projection') as Projection['name']) || 'globe'

    const map = new Map({
      accessToken: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
      container,
      style: 'mapbox://styles/mapbox/standard-beta',
      center: [lng, lat],
      bearing,
      pitch,
      zoom,
      attributionControl: false,
      projection: {
        name: projection,
      },
    })

    this.map = map

    this.initialize()
  }

  initialize() {
    this.map.addControl(new ScaleControl(), 'bottom-right')
    this.map.addControl(new NavigationControl(), 'bottom-right')
    this.map.addControl(new GeolocateControl(), 'bottom-right')
    this.map.addControl(
      new AttributionControl({
        compact: true,
      }),
      'bottom-left',
    )

    this.map.on('load', this.addLayers.bind(this))
    this.map.on('style.load', this.setMapTheme.bind(this, this.options.theme))
  }

  addLayers() {
    Object.values(layers).forEach(layerType => {
      layerType.layers.forEach(layer => {
        if (!layer.enabled) return
        const { meta, source } = layer
        const id = source.id
        this.map.addSource(id, {
          id,
          ...source,
        })
        this.map.addLayer({
          source: id,
          id,
          ...meta,
          slot: 'middle',
        })
      })
    })
  }

  togglePoiLabels(value: boolean) {
    this.map.setConfigProperty('basemap', 'showPointOfInterestLabels', value)
  }

  @ifBasemapLoaded
  setMapTheme(theme: MapTheme) {
    const themeMap: { [key in MapTheme]: string } = {
      light: 'day',
      dark: 'night',
    }
    const lightPreset = themeMap[theme]
    this.map.setConfigProperty('basemap', 'lightPreset', lightPreset)
  }

  setBasemap(basemap: Basemap) {
    const url = basemapUrls[basemap]
    this.map.setStyle(url)
  }

  addDataSource() {
    console.log('MapboxStrategy: adding data source')
  }

  addLayer() {
    console.log('MapboxStrategy: adding layer')
  }

  remove() {
    this.map.remove()
  }
}
