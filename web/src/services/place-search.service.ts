import { ref } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { api } from '@/lib/api'

export interface AutocompletePrediction {
  placeId: string // Will be formatted as "provider/id" for provider-specific places
  description: string // Full description of the place
  mainText: string // Primary text (place name)
  secondaryText: string // Secondary text (usually address)
  types: string[] // Place types
  provider?: string // Added to keep track of the data provider
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

      // Process the suggestions to ensure they have the correct format
      const processedSuggestions = response.data.suggestions.map(suggestion => {
        // If placeId doesn't already include a provider prefix,
        // it's likely a Google place ID and should be prefixed with "google/"
        if (!suggestion.placeId.includes('/')) {
          suggestion.placeId = `google/${suggestion.placeId}`
          suggestion.provider = 'google'
        } else {
          // Extract provider from placeId if it exists (e.g., "osm/node/123456")
          const parts = suggestion.placeId.split('/')
          if (parts.length > 1) {
            suggestion.provider = parts[0]
          }
        }

        return suggestion
      })

      suggestions.value = processedSuggestions
      return processedSuggestions
    } catch (err) {
      console.error('Error fetching place autocomplete:', err)
      error.value =
        err instanceof Error ? err.message : 'Unknown error occurred'
      return []
    } finally {
      loading.value = false
    }
  }

  // Add a function to create a location-based placeId
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
