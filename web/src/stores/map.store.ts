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
  console.count('store instantiated')
  let mapStrategy: MapStrategy
  let setInstanceCount = 0

  function setMapStrategy(map: MapStrategy) {
    console.count('setMapInstance called')
    setInstanceCount++
    console.log('Total setMapInstance calls:', setInstanceCount)
    mapStrategy = map
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

  function initializeLayers(defaultLayers: Layer[]) {
    layers.value = defaultLayers
    defaultLayers.forEach(layer => {
      if (layer.enabled) {
        mapStrategy?.addLayer(layer)
      }
    })
  }

  function addLayer(layer: Layer) {
    layers.value.push(layer)
    if (layer.enabled) {
      mapStrategy?.addLayer(layer)
    }
  }

  function removeLayer(layerId: Layer['id']) {
    const index = layers.value.findIndex(layer => layer.id === layerId)
    if (index !== -1) {
      const layer = layers.value[index]
      if (layer.enabled) {
        mapStrategy?.removeLayer(layerId)
      }
      layers.value.splice(index, 1)
    }
  }

  function updateLayer(updatedLayer: Layer) {
    const index = layers.value.findIndex(layer => layer.id === updatedLayer.id)
    if (index === -1) return

    layers.value[index] = updatedLayer

    if (updatedLayer.enabled) {
      removeLayer(updatedLayer.id)
      addLayer(updatedLayer)
    }
  }

  function toggleLayer(layerId: Layer['id'], enabled?: boolean) {
    const layer = layers.value.find(layer => layer.id === layerId)
    if (layer) {
      const wasEnabled = layer.enabled
      layer.enabled = enabled ?? !wasEnabled

      if (wasEnabled && !enabled) {
        mapStrategy?.removeLayer(layerId)
      } else if (!wasEnabled && enabled) {
        mapStrategy?.addLayer(layer)
      }
    }
  }

  function toggleLayerVisibility(layerId: Layer['id'], visible: boolean) {
    const layer = layers.value.find(layer => layer.id === layerId)
    if (layer) {
      layer.visible = visible
      if (layer.enabled) {
        mapStrategy?.toggleLayerVisibility(layerId, visible)
      }
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
    setMapStrategy,
    mapEngine,
    setMapEngine,
    on,
    off,
    emit,
    mapState,
    setBasemap,
    layers,
    initializeLayers,
    addLayer,
    removeLayer,
    updateLayer,
    toggleLayer,
    toggleLayerVisibility,
    directions,
    setDirections,
    unsetDirections,
  }
})
