import type { MapEvents, MapLibrary } from '@/types/map.types'
import { useMapStore } from '../stores/map.store'
import { createSharedComposable } from '@vueuse/core'

function mapService() {
  const store = useMapStore()

  function on<K extends keyof MapEvents>(
    event: K,
    handler: (data: MapEvents[K]) => void,
  ) {
    store.on(event, handler)
  }

  function off<K extends keyof MapEvents>(
    event: K,
    handler: (data: MapEvents[K]) => void,
  ) {
    store.off(event, handler)
  }

  function emit<K extends keyof MapEvents>(event: K, data: MapEvents[K]) {
    store.emit(event, data)
  }

  return {
    setMapLibrary: store.setMapLibrary,
    setDirections: store.setDirections,
    on,
    off,
    emit,
  }
}

export const useMapService = createSharedComposable(mapService)
