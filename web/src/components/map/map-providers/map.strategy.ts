import {
  Basemap,
  Layer,
  MapCamera,
  MapOptions,
  MapProjection,
  MapTheme,
  Pegman,
} from '@/types/map.types'
import { Locale } from '@/lib/i18n'
import { Directions } from '@/types/directions.types'
import { LngLatLike, LngLat } from 'mapbox-gl' // TODO: This is specific to mapbox, make generic

const defaultOptions: MapOptions = {
  projection: 'mercator',
  theme: MapTheme.LIGHT,
  basemap: 'standard',
}

export class MapStrategy {
  mapInstance: any
  container: HTMLElement
  options: MapOptions
  markers: Map<string, any> = new Map() // Track active markers

  constructor(container, options: MapOptions) {
    this.container = container
    this.options = { ...defaultOptions, ...options }
  }

  resize() {}
  addDataSource() {}
  flyTo(camera: Partial<MapCamera>) {}
  jumpTo(camera: Partial<MapCamera>) {}
  setDirections(directions: Directions) {}
  unsetDirections() {}
  setPegman(pegman: Pegman) {}
  removePegman() {}
  setPoiLabels(value: boolean) {}
  setRoadLabels(value: boolean) {}
  setTransitLabels(value: boolean) {}
  setPlaceLabels(value: boolean) {}
  setMapProjection(projection: MapProjection) {}
  setMap3dTerrain(value: boolean) {}
  setMap3dBuildings(value: boolean) {}
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

  addMarker(id: string, lngLat: LngLat) {
    this.removeMarker(id) // Remove existing marker if any
  }

  removeMarker(id: string) {
    const marker = this.markers.get(id)
    if (marker) {
      marker.remove()
      this.markers.delete(id)
    }
  }

  removeAllMarkers() {
    this.markers.forEach(marker => marker.remove())
    this.markers.clear()
  }
}
