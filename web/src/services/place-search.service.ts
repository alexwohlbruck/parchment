import { ref } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { api } from '@/lib/api'
import type { UnifiedPlace } from '@/types/unified-place.types'

interface AutocompleteResponse {
  query: string
  places: UnifiedPlace[] // Updated to use UnifiedPlace
}

function placeSearchService() {
  const loading = ref(false)
  const suggestions = ref<UnifiedPlace[]>([]) // Updated to use UnifiedPlace
  const error = ref<string | null>(null)

  async function getAutocomplete(
    query: string,
    lat?: number,
    lng?: number,
    radius: number = 10000,
  ): Promise<UnifiedPlace[]> {
    if (!query || query.length < 2) {
      return []
    }

    loading.value = true
    error.value = null

    try {
      const params: Record<string, string | number> = { q: query }

      if (lat !== undefined && lng !== undefined) {
        params.lat = lat.toString()
        params.lng = lng.toString()
      }

      if (radius) {
        params.radius = radius.toString()
      }

      const response = await api.get<AutocompleteResponse>(
        '/places/autocomplete',
        { params },
      )

      suggestions.value = response.data.places // Updated to use places
      return response.data.places // Updated to use places
    } catch (err) {
      console.error('Error fetching place autocomplete:', err)
      error.value =
        err instanceof Error ? err.message : 'Unknown error occurred'
      return []
    } finally {
      loading.value = false
    }
  }

  function createLocationPlaceId(
    name: string,
    lat: number,
    lng: number,
  ): string {
    return `location/${encodeURIComponent(name)}/${lat}/${lng}`
  }

  return {
    loading,
    suggestions,
    error,
    getAutocomplete,
    createLocationPlaceId,
  }
}

export const usePlaceSearchService = createSharedComposable(placeSearchService)
