import {
  Basemap,
  Layer,
  MapCamera,
  MapOptions,
  MapTheme,
} from '@/types/map.types'
import { Locale } from '@/lib/i18n'
import { Directions } from '@/types/directions.types'

const defaultOptions: MapOptions = {
  projection: 'mercator',
  theme: MapTheme.LIGHT,
  basemap: 'standard',
}

export class MapStrategy {
  mapInstance: any
  container: HTMLElement
  options: MapOptions

  constructor(container, options: MapOptions) {
    this.container = container
    this.options = { ...defaultOptions, ...options }
  }

  initialize() {}
  addDataSource() {}
  flyTo(camera: Partial<MapCamera>) {}
  setDirections(directions: Directions) {}
  unsetDirections() {}
  setMapTheme(theme: MapTheme) {}
  setBasemap(basemap: Basemap) {}
  removeSource(sourceId: string) {}
  addLayer(layer: Layer, overwrite: boolean = false) {}
  removeLayer(layerId: Layer['configuration']['id']) {}
  updateLayer(layerId: Layer['configuration']['id'], updates: Partial<Layer>) {}
  toggleLayer(layerId: string, state?: boolean) {}
  toggleLayerVisibility(
    layerId: Layer['configuration']['id'],
    state?: boolean,
  ) {}
  destroy() {}
}
