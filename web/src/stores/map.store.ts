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
  MapStyleId,
  PoiStyleId,
  Pegman,
  MapProjection,
  MapControlSettings,
  ControlVisibility,
  LocateFlySpeed,
  StartupLocation,
  GridSnapMode,
} from '@/types/map.types'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { useStorage } from '@vueuse/core'

const emitter = mitt<MapEvents>()

const defaultSettings: MapSettings = {
  theme: MapTheme.LIGHT,
  engine: MapEngine.MAPBOX,
  projection: MapProjection.GLOBE,
  basemap: 'standard',
  mapStyle: 'parchment',
  poiStyle: 'badge',
  terrain3d: false,
  buildings3d: true,
  objects3d: true,
  poiLabels: true,
  roadLabels: true,
  transitLabels: true,
  placeLabels: true,
  hdRoads: false,
  indoorMaps: false,
  northUpSnap: true,
  gridSnapMode: GridSnapMode.NORTH_UP,
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
    streetView: isMobile
      ? ControlVisibility.WHILE_ACTIVE
      : ControlVisibility.ALWAYS,
    locate: ControlVisibility.ALWAYS,
    weather: ControlVisibility.ALWAYS,
  }
}

export const useMapStore = defineStore('map', () => {
  let mapStrategy: MapStrategy

  function setMapStrategy(map: MapStrategy) {
    mapStrategy = map
  }

  /**
   * The live map strategy, or undefined before the map has loaded. Kept out
   * of reactive state deliberately — it wraps a mapbox/maplibre instance,
   * and making that a Pinia ref would have Vue walk the whole map object on
   * every change.
   */
  function getMapStrategy(): MapStrategy | undefined {
    return mapStrategy
  }

  const settings = useStorage<MapSettings>('map', defaultSettings)

  /**
   * The user's own appearance settings, parked while a canvas overrides them.
   *
   * Overrides are applied by writing into `settings`, so every watcher and
   * strategy call that already reacts to them keeps working — there is no
   * second path to the map. That leaves one hazard: `settings` is persisted,
   * so a tab closed mid-canvas would leave the canvas's choices looking like
   * the user's. Parking the originals here, persisted too, means the next
   * start can always hand them back.
   */
  // Empty rather than null: `useStorage` picks its serializer from the
  // default, and a null default gets the one that stringifies with `String()`
  // — an object written through it comes back as "[object Object]".
  const parkedSettings = useStorage<Partial<MapSettings>>(
    'map-parked-settings',
    {},
  )

  // Anything still parked at startup was never handed back — the tab went
  // away while a canvas had the map. Give it back now, BEFORE the migration
  // below: while a canvas holds the map, `settings` carries the canvas's
  // choices, and deriving the 3D split from those would hand the user back a
  // skyline the canvas asked for rather than the one they set.
  if (Object.keys(parkedSettings.value).length) {
    Object.assign(settings.value, parkedSettings.value)
    parkedSettings.value = {}
  }

  // One-time split of the single "3D objects" switch into buildings and scene
  // objects. `useStorage` returns the stored object as-is rather than merging
  // new defaults into it, so without this an existing install would come back
  // with `buildings3d` undefined and its skyline flat.
  if (settings.value.buildings3d === undefined) {
    settings.value.buildings3d = settings.value.objects3d ?? true
  }
  if (settings.value.objects3d === undefined) settings.value.objects3d = true
  const controlSettings = useStorage<MapControlSettings>(
    'map-controls',
    getDefaultControlSettings(),
  )

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

  function setMapStyle(styleId: MapStyleId) {
    settings.value.mapStyle = styleId
  }

  function setPoiStyle(poiStyle: PoiStyleId) {
    settings.value.poiStyle = poiStyle
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
    parkedSettings,

    setMapStrategy,
    getMapStrategy,
    settings,
    controlSettings,
    mapCamera,
    setMapCamera,
    setBasemap,
    setMapStyle,
    setPoiStyle,
    on,
    off,
    emit,
    pegman,
    setPegman,
    clearPegman,
  }
})
