import { ref } from 'vue'
import { defineStore } from 'pinia'
import { Basemap, MapLayer } from '../types/map.types'
import { MapLibrary, MapOptions } from '@/types/map.types'
import { Directions } from '@/types/directions.types'

export const useMapStore = defineStore('map', () => {
  const mapLibrary = ref<MapLibrary>('mapbox')

  function setMapLibrary(library: MapLibrary) {
    mapLibrary.value = library
  }

  const mapState = ref<MapOptions>({
    center: [-80.8432808, 35.2205601],
    zoom: 14,
    bearing: 0,
    pitch: 0,
    projection: 'web-mercator',
    theme: 'light',
    basemap: 'standard',
    layers: [],
  })

  const directions = ref<null | Directions>(null)

  function setBasemap(map: Basemap) {
    mapState.value.basemap = map
  }

  function addLayer(layer: MapLayer) {
    mapState.value.layers = [...mapState.value.layers, layer]
  }

  function removeLayer(layer: MapLayer) {
    mapState.value.layers = mapState.value.layers.filter(l => l !== layer)
  }

  function toggleLayer(layer: MapLayer, state?: boolean) {
    if (state === undefined) {
      state = !mapState.value.layers.includes(layer)
    }
    if (state) {
      addLayer(layer)
    } else {
      removeLayer(layer)
    }
  }

  function setDirections(directions_: Directions) {
    directions.value = directions_
  }

  function unsetDirections() {
    directions.value = null
  }

  return {
    mapLibrary,
    setMapLibrary,
    mapState,
    setBasemap,
    toggleLayer,
    directions,
    setDirections,
    unsetDirections,
  }
})
