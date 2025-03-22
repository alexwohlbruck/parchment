import { ref } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { useAppService } from '@/services/app.service'
import { API_BASE_URL } from '@/lib/constants'
import type { UnifiedPlace } from '@/types/unified-place.types'

function placeService() {
  const currentPlace = ref<UnifiedPlace | null>(null)
  const loading = ref(false)
  const { toast } = useAppService()

  async function fetchPlaceDetails(
    osmId: string,
    type: 'node' | 'way' | 'relation' | 'unknown',
  ) {
    if (type === 'unknown') return null

    loading.value = true

    try {
      const response = await fetch(`${API_BASE_URL}/places/${type}/${osmId}`)

      if (!response.ok) {
        throw new Error(
          `Failed to fetch place details (HTTP ${response.status})`,
        )
      }

      const place = (await response.json()) as UnifiedPlace

      currentPlace.value = place
      return place
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'An error occurred')
      currentPlace.value = null
      return null
    } finally {
      loading.value = false
    }
  }

  function clearPlace() {
    currentPlace.value = null
  }

  return {
    currentPlace,
    loading,
    fetchPlaceDetails,
    clearPlace,
  }
}

export const usePlaceService = createSharedComposable(placeService)
