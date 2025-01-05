import type { MapEvents, MapEngine } from '@/types/map.types'
import { useMapStore } from '../stores/map.store'
import { createSharedComposable } from '@vueuse/core'

function mapService() {
  const store = useMapStore()

  /**
   * Map events
   */
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
    toggleLayer,
    setMapEngine: store.setMapEngine,
    setDirections: store.setDirections,
    on,
    off,
    emit,
  }
}

export const useMapService = createSharedComposable(mapService)
