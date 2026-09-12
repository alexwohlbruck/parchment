import { getCurrentScope, onScopeDispose, watch } from 'vue'
import { useMapService } from '@/services/map/map.service'

/**
 * Run something once the map has initialized.
 *
 * On a fresh tab the map comes up async, so anything reaching for it on mount —
 * flying the camera, reading bounds, placing markers — has to wait or it fails
 * against an undefined strategy. The wait is abandoned if the caller goes away
 * first, so a view left during startup doesn't move the map behind its
 * replacement.
 */
export function whenMapReady(callback: () => void): void {
  const mapService = useMapService()

  if (mapService.isMapReady.value) {
    callback()
    return
  }

  let disposed = false
  const unwatch = watch(
    () => mapService.isMapReady.value,
    (ready) => {
      if (!ready || disposed) return
      unwatch()
      callback()
    },
  )

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true
      unwatch()
    })
  }
}
