/**
 * A canvas's own map appearance, while you are looking at it.
 *
 * A canvas is a composed view: a hiking map wants terrain and no transit
 * labels, a transit map wants the opposite, and neither should mean changing
 * the settings you keep for everything else. So a canvas can carry its own
 * set, which takes over while it is open and is handed back on the way out.
 *
 * Applied by writing into the map settings themselves rather than through a
 * parallel path — every watcher and strategy call that already reacts to
 * them keeps working, and there is only ever one answer to "what is the map
 * showing". The user's own values are parked in the store while that lasts;
 * see `parkedSettings` for why they are persisted rather than held here.
 */

import { onScopeDispose, watch, type Ref } from 'vue'
import { useMapStore } from '@/stores/map.store'
import {
  CANVAS_MAP_SETTING_KEYS,
  type CanvasMapSettings,
} from '@/types/canvas.types'

/**
 * What the app is set to right now, for the keys a canvas can override — the
 * set a canvas starts from when it takes appearance into its own hands.
 */
export function currentMapSettings(): CanvasMapSettings {
  const mapStore = useMapStore()
  return Object.fromEntries(
    CANVAS_MAP_SETTING_KEYS.map(key => [key, mapStore.settings[key]]),
  ) as unknown as CanvasMapSettings
}

export function useCanvasMapSettings(
  overrides: Ref<CanvasMapSettings | undefined>,
) {
  const mapStore = useMapStore()

  function isParked() {
    return Object.keys(mapStore.parkedSettings).length > 0
  }

  function park() {
    if (isParked()) return
    mapStore.parkedSettings = currentMapSettings()
  }

  function unpark() {
    if (!isParked()) return
    Object.assign(mapStore.settings, mapStore.parkedSettings)
    mapStore.parkedSettings = {}
  }

  watch(
    overrides,
    next => {
      if (!next) {
        unpark()
        return
      }
      park()
      Object.assign(mapStore.settings, next)
    },
    { immediate: true, deep: true },
  )

  onScopeDispose(unpark)
}
