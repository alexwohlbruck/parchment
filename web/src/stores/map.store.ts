import mitt from 'mitt'
import { computed, ref, toRaw } from 'vue'
import { defineStore } from 'pinia'
import {
  Basemap,
  MapEngine,
  MapSettings,
  MapEvents,
  MapCamera,
  MapTheme,
  Pegman,
  MapProjection,
} from '@/types/map.types'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { useStorage } from '@vueuse/core'

const emitter = mitt<MapEvents>()

const defaultSettings: MapSettings = {
  theme: MapTheme.LIGHT,
  engine: MapEngine.MAPBOX,
  projection: MapProjection.GLOBE,
  basemap: 'standard',
  terrain3d: false,
  objects3d: true,
  poiLabels: true,
  roadLabels: true,
  transitLabels: true,
  placeLabels: true,
}

export const useMapStore = defineStore('map', () => {
  let mapStrategy: MapStrategy

  function setMapStrategy(map: MapStrategy) {
    mapStrategy = map
  }

  const settings = useStorage<MapSettings>('map', defaultSettings)

  const mapCamera = useStorage<MapCamera>('map-camera', {
    center: [-44.808291513887866, 21.851187958608364],
    zoom: 2,
    bearing: 0,
    pitch: 0,
  })

  function setMapCamera(camera: MapCamera) {
    mapCamera.value = camera
  }

  function setBasemap(basemap: Basemap) {
    settings.value.basemap = basemap
  }

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

  const pegman = ref<Pegman | null>(null)

  function setPegman(pegman_: Pegman) {
    pegman.value = pegman_
  }

  function clearPegman() {
    pegman.value = null
  }

  return {
    setMapStrategy,
    settings,
    mapCamera,
    setMapCamera,
    setBasemap,
    on,
    off,
    emit,
    pegman,
    setPegman,
    clearPegman,
  }
})
