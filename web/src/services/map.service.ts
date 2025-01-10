import type { Layer, MapEngine, MapEvents, MapOptions } from '@/types/map.types'
import { useMapStore } from '../stores/map.store'
import { createSharedComposable, useDark } from '@vueuse/core'
import { mapState, storeToRefs } from 'pinia'
import { MapboxStrategy } from '@/components/map/map-providers/mapbox.strategy'
import { MaplibreStrategy } from '@/components/map/map-providers/maplibre.strategy'
import { mapEventBus } from '@/lib/eventBus'
import { MapStrategy } from '@/components/map/map-providers/map.strategy'
import { ref, watch } from 'vue'

const dark = useDark()

function mapService() {
  const mapStore = useMapStore()
  const { mapState, layers } = storeToRefs(mapStore)
  let mapStrategy: MapStrategy
  let mapContainer: HTMLElement

  function getMapStrategy(
    container: string | HTMLElement,
    mapEngine: MapEngine,
  ) {
    // TODO: Detect theme automatically on map init
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
    container: HTMLElement,
    mapEngine: MapEngine,
    options?: MapOptions,
  ) {
    mapContainer = container as HTMLElement
    mapStrategy = getMapStrategy(container, mapEngine)
    mapStore.setMapStrategy(mapStrategy)

    mapEventBus.on('load', () => {
      mapStore.initializeLayers(layers.value)
    })

    mapEventBus.on('style.load', () => {
      console.log(options?.theme ?? dark.value ? 'dark' : 'light')
      mapStrategy.setMapTheme(options?.theme ?? dark.value ? 'dark' : 'light')
    })

    return mapStrategy
  }

  function setMapEngine(mapEngine: MapEngine) {
    destroy()
    mapStrategy = initializeMap(mapContainer, mapEngine, mapState.value)
    mapStore.setMapEngine(mapEngine)
  }

  watch(dark, newDark => {
    mapStrategy.setMapTheme(newDark ? 'dark' : 'light')
  })

  watch(
    () => mapStore.mapState.basemap,
    basemap => {
      mapStrategy.setBasemap(basemap)
    },
  )

  watch(
    () => mapStore.directions,
    directions => {
      if (directions) {
        mapStrategy.setDirections(directions)
      } else {
        mapStrategy.unsetDirections()
      }
    },
  )

  function toggleLayer(layerId: Layer['configuration']['id'], state?: boolean) {
    mapStore.toggleLayer(layerId, state)
  }

  function toggleLayerVisibility(
    layerId: Layer['configuration']['id'],
    state: boolean,
  ) {
    mapStore.toggleLayerVisibility(layerId, state)
  }

  function destroy() {
    // Remove event listeners
    // TODO: Automatically remove all listeners without explicitly naming them
    mapEventBus.off('load')
    mapEventBus.off('style.load')
    mapStrategy.destroy() // Remove map instance
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
    setMapEngine,
    setDirections: mapStore.setDirections,
    destroy,
    on,
    off,
    emit,
  }
}

export const useMapService = createSharedComposable(mapService)
