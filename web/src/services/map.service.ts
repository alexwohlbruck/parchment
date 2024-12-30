import { MapLibrary } from '../types/map.types'
import { useMapStore } from '../stores/map.store'
import { createSharedComposable } from '@vueuse/core'

function mapService() {
  const { setMapLibrary, setDirections } = useMapStore()

  return {
    setMapLibrary,
    setDirections,
  }
}

export const useMapService = createSharedComposable(mapService)
