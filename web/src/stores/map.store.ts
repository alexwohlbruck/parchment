import mitt from 'mitt'
import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
  Basemap,
  MapEngine,
  MapOptions,
  MapEvents,
  Layer,
} from '@/types/map.types'
import { Directions } from '@/types/directions.types'
import { layers as defaultLayers } from '@/components/map/layers/layers'

const emitter = mitt<MapEvents>()

export const useMapStore = defineStore('map', () => {
  const mapEngine = ref<MapEngine>('mapbox')

  function setMapEngine(engine: MapEngine) {
    mapEngine.value = engine
  }

  const mapState = ref<MapOptions>({
    center: [-80.8432808, 35.2205601],
    zoom: 14,
    bearing: 0,
    pitch: 0,
    projection: 'web-mercator',
    theme: 'light',
    basemap: 'standard',
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

  const layers = ref<Layer[]>(defaultLayers)

  function addLayer(layer: Layer) {
    layers.value.push(layer)
  }

  function removeLayer(layer: Layer) {
    layers.value.splice(layers.value.indexOf(layer), 1)
  }

  // TODO: Toggle layer
  // function toggleLayer(layer: MapLayer, state?: boolean) {
  //   if (state === undefined) {
  //     state = !layers.includes(layer)
  //   }
  //   if (state) {
  //     addLayer(layer)
  //   } else {
  //     removeLayer(layer)
  //   }
  // }

  function setDirections(directions_: Directions) {
    directions.value = directions_
  }

  function unsetDirections() {
    directions.value = null
  }

  return {
    mapEngine,
    setMapEngine,
    on,
    off,
    emit,
    mapState,
    setBasemap,
    layers,
    directions,
    setDirections,
    unsetDirections,
  }
})
