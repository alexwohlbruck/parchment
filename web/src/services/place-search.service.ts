import { ref } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { api } from '@/lib/api'

export interface AutocompletePrediction {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
  types: string[]
}

interface AutocompleteResponse {
  query: string
  suggestions: AutocompletePrediction[]
}

function placeSearchService() {
  const loading = ref(false)
  const suggestions = ref<AutocompletePrediction[]>([])
  const error = ref<string | null>(null)

  async function getAutocomplete(
    query: string,
    lat?: number,
    lng?: number,
    radius: number = 10000,
  ): Promise<AutocompletePrediction[]> {
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
      suggestions.value = response.data.suggestions
      return response.data.suggestions
    } catch (err) {
      console.error('Error fetching place autocomplete:', err)
      error.value =
        err instanceof Error ? err.message : 'Unknown error occurred'
      return []
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    suggestions,
    error,
    getAutocomplete,
  }
}

export const usePlaceSearchService = createSharedComposable(placeSearchService)
