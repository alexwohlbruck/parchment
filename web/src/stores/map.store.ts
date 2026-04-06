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
  MapControlSettings,
  ControlVisibility,
  LocateFlySpeed,
  StartupLocation,
} from '@/types/map.types'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { useStorage } from '@vueuse/core'
import { STORAGE_KEYS } from '@/lib/storage'

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
  hdRoads: false,
  locateFlySpeed: LocateFlySpeed.NORMAL,
  startupLocation: StartupLocation.LAST_VISITED,
}

// Compute default control settings based on screen size (mobile vs desktop)
// This only runs on first load when no saved settings exist
function getDefaultControlSettings(): MapControlSettings {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768 // md breakpoint

  return {
    zoom: isMobile ? ControlVisibility.NEVER : ControlVisibility.ALWAYS,
    compass: isMobile
      ? ControlVisibility.WHILE_ROTATING
      : ControlVisibility.ALWAYS,
    scale: isMobile
      ? ControlVisibility.WHILE_ZOOMING
      : ControlVisibility.ALWAYS,
    streetView: ControlVisibility.ALWAYS,
    locate: ControlVisibility.ALWAYS,
    weather: ControlVisibility.ALWAYS,
    toolbox: ControlVisibility.ALWAYS,
  }
}

export const useMapStore = defineStore('map', () => {
  let mapStrategy: MapStrategy

  function setMapStrategy(map: MapStrategy) {
    mapStrategy = map
  }

  interface MapState {
    settings: MapSettings
    controls: MapControlSettings
    camera: MapCamera
  }

  const state = useStorage<MapState>(STORAGE_KEYS.MAP, {
    settings: defaultSettings,
    controls: getDefaultControlSettings(),
    camera: {
      center: [-44.808291513887866, 21.851187958608364],
      zoom: 2,
      bearing: 0,
      pitch: 0,
    },
  })

  const settings = computed({
    get: () => state.value.settings,
    set: (v: MapSettings) => { state.value.settings = v },
  })

  const controlSettings = computed({
    get: () => state.value.controls,
    set: (v: MapControlSettings) => { state.value.controls = v },
  })

  const mapCamera = computed({
    get: () => state.value.camera,
    set: (v: MapCamera) => { state.value.camera = v },
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
    controlSettings,
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
