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
  mapInstance: any
  container: HTMLElement
  options: MapOptions

  constructor(container, options?: Partial<MapOptions>) {
    this.container = container
    this.options = { ...defaultOptions, ...options }
  }

  initialize() {}
  addDataSource() {}
  setDirections(directions: Directions) {}
  unsetDirections() {}
  setMapTheme(theme: MapTheme) {}
  setBasemap(basemap: Basemap) {}
  removeSource(sourceId: string) {}
  addLayer(layer: Layer) {}
  removeLayer(layerId: Layer['configuration']['id']) {}
  updateLayer(layerId: Layer['configuration']['id'], updates: Partial<Layer>) {}
  toggleLayer(layerId: string, state?: boolean) {}
  toggleLayerVisibility(
    layerId: Layer['configuration']['id'],
    state?: boolean,
  ) {}
  destroy() {}
}
