import { MapStrategy } from './map.strategy'
import {
  Map,
  NavigationControl,
  GeolocateControl,
  AttributionControl,
  ScaleControl,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Basemap, Layer, MapTheme, MapOptions } from '@/types/map.types'
import { layers } from '../layers/layers'
import { Locale } from '@/lib/i18n'

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
  theme: MapTheme = 'light'
  mapInstance: Map

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

    this.mapInstance = new Map({
      container,
      style: basemapUrls.light,
      center: [lng, lat],
      bearing,
      pitch,
      zoom,
      attributionControl: false,
    })
    this.initialize()
  }

  initialize() {
    this.mapInstance.addControl(new ScaleControl({}), 'bottom-right')
    this.mapInstance.addControl(new NavigationControl({}), 'bottom-right')
    this.mapInstance.addControl(new GeolocateControl({}), 'bottom-right')
    this.mapInstance.addControl(
      new AttributionControl({
        compact: true,
      }),
      'bottom-left',
    )

    this.mapInstance.on('load', this.setLayers.bind(this))
    this.mapInstance.on(
      'style.load',
      this.setMapTheme.bind(this, this.options.theme),
    )
  }

  setLocale(locale: Locale) {
    // TODO:
    console.log('TODO: Set locale Maplibre')
  }

  setLayers(layers: Layer[]) {
    const style = this.mapInstance.getStyle()
    if (!style) return
    const mapLayers = style.layers
    const ids = mapLayers.map(layer => layer.id)
    ids.forEach((id: any) => {
      if (!layers.find(layer => layer.id === id)) {
        this.mapInstance.removeLayer(id)
      }
    })

    layers.forEach(layer => {
      const { meta, source } = layer

      const sourceId = typeof source === 'string' ? source : source.id

      // Emissive strength is not supported in MapLibre
      Object.keys(meta.paint).forEach(key => {
        if (key.includes('emissive-strength')) {
          delete meta.paint[key]
        }
      })

      if (typeof source === 'object' && !this.mapInstance.getSource(sourceId)) {
        this.mapInstance.addSource(sourceId, {
          ...source,
          id: sourceId,
        } as any) // TODO: Fix type
      }

      this.mapInstance.addLayer({
        ...meta,
        source: sourceId,
        id: layer.id,
        type: layer.type,
        layout: {
          ...meta?.layout,
          visibility: 'none',
        },
      })
    })
  }

  togglePoiLabels() {
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
}
