import { ref } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { Place } from '@/types/map.types'

function placeService() {
  const currentPlace = ref<Place | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchPlaceDetails(
    osmId: string,
    type: 'node' | 'way' | 'relation' | 'unknown',
  ) {
    if (type === 'unknown') return null

    loading.value = true
    error.value = null

    try {
      const query = `[out:json][timeout:25];
      ${type}(${osmId});
      out body meta center geom;`
      const response = await fetch(
        `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(
          query,
        )}`,
      )
      if (!response.ok) throw new Error('Failed to fetch place details')

      const data = await response.json()
      const place = data.elements?.[0] as Place

      if (!place) throw new Error('Place not found')

      currentPlace.value = place
      return place
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'An error occurred'
      currentPlace.value = null
      return null
    } finally {
      loading.value = false
    }
  }

  function clearPlace() {
    currentPlace.value = null
    error.value = null
  }

  return {
    currentPlace,
    loading,
    error,
    fetchPlaceDetails,
    clearPlace,
  }
}

export const usePlaceService = createSharedComposable(placeService)
