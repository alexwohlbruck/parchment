import { ref } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { useAppService } from '@/services/app.service'
import { api } from '@/lib/api'
import type { UnifiedPlace } from '@/types/unified-place.types'

function placeService() {
  const currentPlace = ref<UnifiedPlace | null>(null)
  const loading = ref(false)
  const { toast } = useAppService()

  /**
   * Fetch place details using the new unified lookup endpoint
   */
  async function fetchPlaceDetails(
    id: string,
    provider: string = 'osm',
    options?: {
      name?: string
      lat?: number
      lng?: number
      radius?: number
    },
  ) {
    loading.value = true

    try {
      let queryParams: Record<string, string> = {}

      // Determine lookup method based on parameters
      if (provider && id) {
        // Provider-based lookup (OSM, Google, etc.)
        queryParams = {
          provider,
          id,
        }
      } else if (
        options?.name &&
        options?.lat !== undefined &&
        options?.lng !== undefined
      ) {
        // Location-based lookup
        queryParams = {
          name: options.name,
          lat: options.lat.toString(),
          lng: options.lng.toString(),
        }

        // Add radius if specified
        if (options.radius) {
          queryParams.radius = options.radius.toString()
        }
      } else {
        throw new Error(
          'Invalid parameters. Provide either provider+id or name+lat+lng',
        )
      }

      const response = await api.get<UnifiedPlace>('/places/lookup', {
        params: queryParams,
      })

      currentPlace.value = response.data
      return response.data
    } catch (e) {
      console.error('Error fetching place details:', e)
      toast.error(e instanceof Error ? e.message : 'An error occurred')
      currentPlace.value = null
      return null
    } finally {
      loading.value = false
    }
  }

  /**
   * Legacy method for backward compatibility - uses the new lookup endpoint
   */
  async function fetchPlaceByOsmId(
    osmId: string,
    type: 'node' | 'way' | 'relation' | 'unknown',
  ) {
    if (type === 'unknown') return null

    // Use the new method with OSM provider and properly formatted ID
    return fetchPlaceDetails(`${type}/${osmId}`, 'osm')
  }

  function clearPlace() {
    currentPlace.value = null
  }

  return {
    currentPlace,
    loading,
    fetchPlaceDetails,
    fetchPlaceByOsmId, // Legacy method
    clearPlace,
  }
}

export const usePlaceService = createSharedComposable(placeService)
