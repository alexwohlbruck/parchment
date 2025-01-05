import mitt from 'mitt'
import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
  Basemap,
  MapEngine,
  MapOptions,
  MapEvents,
  Layer,
  MapInstance,
} from '@/types/map.types'
import { Directions } from '@/types/directions.types'
import { layers as defaultLayers } from '@/components/map/layers/layers'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'

const emitter = mitt<MapEvents>()

export const useMapStore = defineStore('map', () => {
  const mapInstance = ref<MapStrategy>()

  function setMapInstance(map: MapStrategy) {
    mapInstance.value = map
  }

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

  function setDirections(directions_: Directions) {
    directions.value = directions_
  }

  function unsetDirections() {
    directions.value = null
  }

  return {
    mapInstance,
    setMapInstance,
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
