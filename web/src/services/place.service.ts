import { ref } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { useAppService } from '@/services/app.service'
import { api } from '@/lib/api'
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
      const response = await api.get<UnifiedPlace>(`/places/${type}/${osmId}`)
      currentPlace.value = response.data
      return response.data
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
