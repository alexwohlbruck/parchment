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

      // Calculate and add center if not provided by Overpass
      if (!place.center && place.bounds) {
        place.center = {
          lat: (place.bounds.minlat + place.bounds.maxlat) / 2,
          lon: (place.bounds.minlon + place.bounds.maxlon) / 2,
        }
      } else if (!place.center && place.geometry?.length) {
        const sumLat = place.geometry.reduce((sum, point) => sum + point.lat, 0)
        const sumLon = place.geometry.reduce((sum, point) => sum + point.lon, 0)
        const count = place.geometry.length
        place.center = {
          lat: sumLat / count,
          lon: sumLon / count,
        }
      }

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
