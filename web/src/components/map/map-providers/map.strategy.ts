import { Basemap, Layer, MapOptions, MapTheme } from '@/types/map.types'
import { Locale } from '@/lib/i18n'
import { Directions } from '@/types/directions.types'

const defaultOptions: MapOptions = {
  center: [-80.8432808, 35.2205601],
  zoom: 14,
  bearing: 0,
  pitch: 0,
  projection: 'mercator',
  theme: 'light',
  basemap: 'standard',
}

export class MapStrategy {
  map: any
  container: HTMLElement
  options: MapOptions

  constructor(container, options?: Partial<MapOptions>) {
    this.container = container
    this.options = { ...defaultOptions, ...options }
  }

  initialize() {}
  addDataSource() {}
  setLocale(locale: Locale) {} // TODO:
  setDirections(directions: Directions) {}
  unsetDirections() {}
  setMapTheme(theme: MapTheme) {}
  setBasemap(basemap: Basemap) {}
  setLayers(layers: Layer[]) {}
  toggleLayer(layerId: string, state?: boolean) {}
  toggleLayerVisibility(layerId: Layer['id'], state?: boolean) {}
  remove() {}
}
