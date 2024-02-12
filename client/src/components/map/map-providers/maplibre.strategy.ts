import { MapOptions, MapStrategy } from './map.strategy'
import {
  Map,
  NavigationControl,
  GeolocateControl,
  AttributionControl,
  ScaleControl,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

const LIGHT_STYLE = `https://api.maptiler.com/maps/streets-v2/style.json?key=${
  import.meta.env.VITE_MAPTILER_API_KEY
}`
const DARK_STYLE = `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${
  import.meta.env.VITE_MAPTILER_API_KEY
}`

export class MaplibreStrategy extends MapStrategy {
  constructor(container, options?: MapOptions) {
    // For testing
    const { lng, lat, zoom, bearing, pitch } = {
      lng: -80.8432808,
      lat: 35.2205601,
      bearing: 0,
      pitch: 0,
      zoom: 14,
    }

    const map = new Map({
      container,
      style: LIGHT_STYLE,
      center: [lng, lat],
      bearing,
      pitch,
      zoom,
      attributionControl: false,
    })

    super(container, map, options)
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
    this.setMapTheme(this.options.dark)
  }

  setMapTheme(dark: boolean) {
    this.map.setStyle(dark ? DARK_STYLE : LIGHT_STYLE)
  }
}
