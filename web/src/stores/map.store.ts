import mitt from 'mitt'
import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
  Basemap,
  MapLayer,
  MapLibrary,
  MapOptions,
  MapEvents,
} from '@/types/map.types'
import { Directions } from '@/types/directions.types'

const emitter = mitt<MapEvents>()

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

  // Event methods
  function on<K extends keyof MapEvents>(
    event: K,
    handler: (data: MapEvents[K]) => void,
  ) {
    emitter.on(event, handler)
  }

  function off<K extends keyof MapEvents>(
    event: K,
    handler: (data: MapEvents[K]) => void,
  ) {
    emitter.off(event, handler)
  }

  function emit<K extends keyof MapEvents>(event: K, data: MapEvents[K]) {
    emitter.emit(event, data)
  }

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
    on,
    off,
    emit,
    mapState,
    setBasemap,
    toggleLayer,
    directions,
    setDirections,
    unsetDirections,
  }
})
