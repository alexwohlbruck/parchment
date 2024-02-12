import { MapOptions, MapStrategy } from './map.strategy'
import {
  Map,
  NavigationControl,
  GeolocateControl,
  AttributionControl,
  ScaleControl,
} from 'mapbox-gl'

import { layers } from '../layers' // TODO: Refactor layers init

export class MapboxStrategy extends MapStrategy {
  constructor(container, options?: MapOptions) {
    // For testing
    const { lng, lat, zoom, bearing, pitch } = {
      lng: -80.8432808,
      lat: 35.2205601,
      bearing: 0,
      pitch: 0,
      zoom: 14,
    }
    const projection: any = localStorage.getItem('projection') || 'globe'

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

    super(container, map, options)
  }

  initialize() {
    this.map.addControl(new ScaleControl(), 'bottom-right')
    this.map.addControl(new NavigationControl(), 'bottom-right')
    this.map.addControl(new GeolocateControl(), 'bottom-right')
    this.map.addControl(
      new AttributionControl({
        compact: true,
      }),
      'bottom-left'
    )

    this.softInitialize()
    this.map.on('load', this.softInitialize.bind(this))
    this.map.on('style.load', this.softInitialize.bind(this))
  }

  // When map style is loaded, we need to reset the theme and add layers
  softInitialize() {
    this.addLayers()
    this.setMapTheme(this.options.dark)
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

  setMapTheme(dark: boolean) {
    let lightPreset
    switch (dark) {
      case false:
        lightPreset = 'day'
        break
      case true:
        lightPreset = 'night'
        break
    }
    this.map.setConfigProperty('basemap', 'lightPreset', lightPreset)
  }

  setStyle(url: string) {
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
