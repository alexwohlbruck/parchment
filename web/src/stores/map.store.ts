import mitt from 'mitt'
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  Basemap,
  MapEngine,
  MapOptions,
  MapEvents,
  Layer,
  MapCamera,
  MapTheme,
  StreetViewImage,
  LngLat,
  Pegman,
  MapProjection,
} from '@/types/map.types'
import { layers as defaultLayers } from '@/components/map/layers/layers'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { useStorage } from '@vueuse/core'

const emitter = mitt<MapEvents>()

export const useMapStore = defineStore('map', () => {
  let mapStrategy: MapStrategy
  function setMapStrategy(map: MapStrategy) {
    mapStrategy = map
  }

  const mapEngine = ref<MapEngine>(MapEngine.MAPBOX)
  function setMapEngine(engine: MapEngine) {
    mapEngine.value = engine
  }

  const mapProjection = ref<MapProjection>(MapProjection.GLOBE)
  function setMapProjection(projection: MapProjection) {
    mapProjection.value = projection
  }

  const map3dTerrain = ref<boolean>(false)
  function setMap3dTerrain(value?: boolean) {
    map3dTerrain.value = value ?? !map3dTerrain.value
  }

  const map3dBuildings = ref<boolean>(false)
  function setMap3dBuildings(value?: boolean) {
    map3dBuildings.value = value ?? !map3dBuildings.value
  }

  const mapCamera = useStorage<MapCamera>('map-camera', {
    center: [-44.808291513887866, 21.851187958608364],
    zoom: 2,
    bearing: 0,
    pitch: 0,
  })
  function setMapCamera(camera: MapCamera) {
    mapCamera.value = camera
  }

  const mapOptions = ref<MapOptions>({
    projection: 'web-mercator',
    theme: MapTheme.LIGHT,
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

  function setBasemap(map: Basemap) {
    mapOptions.value.basemap = map
  }

  const layers = ref<Layer[]>(defaultLayers)

  const enabledLayers = computed(() =>
    layers.value.filter(
      layer => layer.enabled && layer.engine.includes(mapEngine.value),
    ),
  )

  function initializeLayers(layers_: Layer[]) {
    layers_.forEach(layer => {
      mapStrategy?.addLayer(layer)
    })
  }

  function addLayer(layer: Layer) {
    layers.value.push(layer)
    if (layer.enabled) {
      mapStrategy?.addLayer(layer)
    }
  }

  function removeLayer(layerId: Layer['configuration']['id']) {
    const index = layers.value.findIndex(
      layer => layer.configuration.id === layerId,
    )
    if (index !== -1) {
      const layer = layers.value[index]
      if (layer.enabled) {
        mapStrategy?.removeLayer(layerId)
      }
      layers.value.splice(index, 1)
    }
  }

  function updateLayer(updatedLayer: Layer) {
    const layer = layers.value.find(
      layer => layer.configuration.id === updatedLayer.configuration.id,
    )
    if (!layer) return

    // Update properties of existing layer object to maintain reactivity
    Object.assign(layer, updatedLayer)

    mapStrategy?.removeLayer(layer.configuration.id)
    if (typeof layer.configuration.source === 'object') {
      mapStrategy?.removeSource(layer.configuration.source.id)
    }
    mapStrategy?.addLayer(layer)
  }

  function toggleLayer(
    layerId: Layer['configuration']['id'],
    enabled?: boolean,
  ) {
    const layer = layers.value.find(layer => layer.configuration.id === layerId)
    if (!layer) return

    const newEnabled = enabled ?? !layer.enabled
    const updatedLayer = { ...layer, enabled: newEnabled }

    updateLayer(updatedLayer)
  }

  function toggleLayerVisibility(
    layerId: Layer['configuration']['id'],
    visible: boolean,
  ) {
    const layer = layers.value.find(layer => layer.configuration.id === layerId)
    if (layer) {
      layer.visible = visible
      if (layer.enabled) {
        mapStrategy?.toggleLayerVisibility(layerId, visible)
      }
    }
  }

  const pegman = ref<Pegman | null>(null)

  function setPegman(pegman_: Pegman) {
    pegman.value = pegman_
  }

  function clearPegman() {
    pegman.value = null
  }

  return {
    setMapStrategy,
    mapEngine,
    setMapEngine,
    mapProjection,
    setMapProjection,
    map3dTerrain,
    setMap3dTerrain,
    map3dBuildings,
    setMap3dBuildings,
    mapCamera,
    setMapCamera,
    on,
    off,
    emit,
    mapOptions,
    setBasemap,
    layers,
    enabledLayers,
    initializeLayers,
    addLayer,
    removeLayer,
    updateLayer,
    toggleLayer,
    toggleLayerVisibility,
    pegman,
    setPegman,
    clearPegman,
  }
})
