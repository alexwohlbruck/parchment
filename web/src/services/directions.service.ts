import { api } from '@/lib/api'
import { createSharedComposable } from '@vueuse/core'
import type { Location } from '@/types/directions.types'

function directionsService() {
  async function getDirections(locations: Location[]) {
    const { data: directions } = await api.post('/directions', {
      locations,
      options: {}, // TODO:
    })
    return directions
  }

  return {
    getDirections,
  }
}

export const useDirectionsService = createSharedComposable(directionsService)
