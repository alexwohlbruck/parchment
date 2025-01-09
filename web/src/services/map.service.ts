import type { Layer, MapEngine, MapEvents, MapOptions } from '@/types/map.types'
import { useMapStore } from '../stores/map.store'
import { createSharedComposable, useDark } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { MapboxStrategy } from '@/components/map/map-providers/mapbox.strategy'
import { MaplibreStrategy } from '@/components/map/map-providers/maplibre.strategy'
import { mapEventBus } from '@/lib/eventBus'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { ref } from 'vue'

const dark = useDark()

function mapService() {
  const mapStore = useMapStore()
  const { layers } = storeToRefs(mapStore)
  const mapStrategy = ref<MapStrategy>()

  function getMapStrategy(
    container: string | HTMLElement,
    mapEngine: MapEngine,
  ) {
    const options: Partial<MapOptions> = {
      theme: dark.value ? 'dark' : 'light',
    }
    switch (mapEngine) {
      case 'mapbox':
        return new MapboxStrategy(container, options)
      case 'maplibre':
        return new MaplibreStrategy(container, options)
    }
  }

  function initializeMap(
    container: string | HTMLElement,
    mapEngine: MapEngine,
    options?: MapOptions,
  ) {
    mapStrategy.value = getMapStrategy(container, mapEngine)
    mapStore.setMapInstance(mapStrategy.value)

    mapEventBus.on('load', () => {
      // mapStrategy.value?.setLayers(layers.value)
    })

    mapEventBus.on('style.load', () => {
      mapStrategy.value?.setMapTheme(
        options?.theme ?? dark.value ? 'dark' : 'light',
      )
    })

    return mapStrategy.value
  }

  function toggleLayer(layerId: Layer['id'], state?: boolean) {
    mapStrategy.value?.toggleLayerVisibility(layerId, state)
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
    initializeMap,
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
