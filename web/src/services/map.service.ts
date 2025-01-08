import type { Layer, MapEvents } from '@/types/map.types'
import { useMapStore } from '../stores/map.store'
import { createSharedComposable } from '@vueuse/core'

function mapService() {
  const mapStore = useMapStore()

  function toggleLayer(layerId: Layer['id'], state?: boolean) {
    mapStore.toggleLayer(layerId, state)
  }

  function toggleLayerVisibility(layerId: Layer['id'], state: boolean) {
    mapStore.toggleLayerVisibility(layerId, state)
  }

  /**
   * Map events
   */
  function on<K extends keyof MapEvents>(
    event: K,
    handler: (data: MapEvents[K]) => void,
  ) {
    mapStore.on(event, handler)
  }

  function off<K extends keyof MapEvents>(
    event: K,
    handler: (data: MapEvents[K]) => void,
  ) {
    mapStore.off(event, handler)
  }

  function emit<K extends keyof MapEvents>(event: K, data: MapEvents[K]) {
    mapStore.emit(event, data)
  }

  return {
    toggleLayer,
    toggleLayerVisibility,
    setMapEngine: mapStore.setMapEngine,
    setDirections: mapStore.setDirections,
    on,
    off,
    emit,
  }
}

export const useMapService = createSharedComposable(mapService)
