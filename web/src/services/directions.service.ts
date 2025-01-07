import { api } from '@/lib/api'
import { createSharedComposable } from '@vueuse/core'
import type { Location, ValhallaRouteRequest } from '@/types/directions.types'

function directionsService() {
  async function getDirections(payload: ValhallaRouteRequest) {
    const { data: directions } = await api.post('/directions', payload)
    return directions
  }

  return {
    getDirections,
  }
}

export const useDirectionsService = createSharedComposable(directionsService)
