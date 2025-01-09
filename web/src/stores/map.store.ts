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
import { MapStrategy } from '@/components/map/map-providers/map.strategy'

const emitter = mitt<MapEvents>()

export const useMapStore = defineStore('map', () => {
  const mapStrategy = ref<MapStrategy>()

  function setMapInstance(map: MapStrategy) {
    mapStrategy.value = map
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

  function addLayer(layer: Layer) {
    layers.value = [...layers.value, layer]
  }

  function updateLayer(layer: Layer) {
    const existingLayerIndex = layers.value.findIndex(
      existingLayer => existingLayer.id === layer.id,
    )
    if (existingLayerIndex !== -1) {
      layers.value = [
        ...layers.value.slice(0, existingLayerIndex),
        layer,
        ...layers.value.slice(existingLayerIndex + 1),
      ]
    }
  }

  function toggleLayer(layerId: Layer['id'], enabled?: boolean) {
    const layer = layers.value.find(layer => layer.id === layerId)
    if (layer) {
      layer.enabled = enabled ?? !layer.enabled
    }
  }

  function toggleLayerVisibility(layerId: Layer['id'], enabled: boolean) {
    console.log('toggleLayerVisibility', layerId, enabled)
    const layer = layers.value.find(layer => layer.id === layerId)
    if (layer) {
      layer.visible = enabled
      mapStrategy.value?.toggleLayerVisibility(layerId, enabled)
    }
  }

  function setDirections(directions_: Directions) {
    directions.value = directions_
  }

  function unsetDirections() {
    directions.value = null
  }

  return {
    mapInstance: mapStrategy,
    setMapInstance,
    mapEngine,
    setMapEngine,
    on,
    off,
    emit,
    mapState,
    setBasemap,
    layers,
    addLayer,
    updateLayer,
    toggleLayer,
    toggleLayerVisibility,
    directions,
    setDirections,
    unsetDirections,
  }
})
