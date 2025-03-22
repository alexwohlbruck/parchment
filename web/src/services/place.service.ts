import { ref } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import type { Place } from '@/types/map.types'
import { useAppService } from '@/services/app.service'
import { API_BASE_URL } from '@/lib/constants'

function placeService() {
  const currentPlace = ref<Place | null>(null)
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

      const place = (await response.json()) as Place

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
