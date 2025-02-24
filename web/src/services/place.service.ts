import { ref } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { Place } from '@/types/map.types'
import { calculatePlaceCenter } from '@/lib/place.utils'
import { OVERPASS_API_URL } from '@/lib/constants'
import { useAppService } from '@/services/app.service'

function placeService() {
  const currentPlace = ref<Place | null>(null)
  const loading = ref(false)
  const { toast } = useAppService()

  function buildOverpassQuery(type: string, id: string) {
    return `[out:json][timeout:25];
      ${type}(${id});
      out body meta center geom;`
  }

  async function fetchPlaceDetails(
    osmId: string,
    type: 'node' | 'way' | 'relation' | 'unknown',
  ) {
    if (type === 'unknown') return null

    loading.value = true

    try {
      const query = buildOverpassQuery(type, osmId)
      const response = await fetch(
        `${OVERPASS_API_URL}?data=${encodeURIComponent(query)}`,
      )

      if (!response.ok) {
        throw new Error(
          `Failed to fetch place details (HTTP ${response.status})`,
        )
      }

      const data = await response.json()
      const place = data.elements?.[0] as Place

      if (!place) {
        throw new Error(`Place not found: ${osmId}`)
      }

      // Calculate center coordinates
      const center = calculatePlaceCenter(place)
      if (center) {
        place.center = center
      }

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
