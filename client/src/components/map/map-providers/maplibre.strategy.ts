import { MapOptions, MapStrategy } from './map.strategy'
import {
  Map,
  NavigationControl,
  GeolocateControl,
  AttributionControl,
  ScaleControl,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Basemap, MapTheme } from '@/types/map.types'

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

    this.map = new Map({
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
    this.map.addControl(new ScaleControl({}), 'bottom-right')
    this.map.addControl(new NavigationControl({}), 'bottom-right')
    this.map.addControl(new GeolocateControl({}), 'bottom-right')
    this.map.addControl(
      new AttributionControl({
        compact: true,
      }),
      'bottom-left',
    )

    this.softInitialize()
    this.map.on('load', this.softInitialize.bind(this))
    this.map.on('style.load', this.softInitialize.bind(this))
  }

  // When map style is loaded, we need to reset the theme and add layers
  softInitialize() {
    // this.addLayers()
    this.setMapTheme(this.options.theme)
  }

  getBasemapFromTheme() {
    return this.options.theme === 'dark' ? basemapUrls.dark : basemapUrls.light
  }

  setMapTheme(theme: MapTheme) {
    this.options.theme = theme
    this.map.setStyle(this.getBasemapFromTheme())
  }

  setBasemap(basemap: Basemap) {
    const themeMap: {
      [key in Basemap]: string
    } = {
      standard: this.getBasemapFromTheme(),
      satellite: basemapUrls.satellite,
      hybrid: basemapUrls.hybrid,
    }
    this.map.setStyle(themeMap[basemap])
  }
}
