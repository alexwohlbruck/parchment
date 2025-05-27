import { ref } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { api } from '@/lib/api'
import type { Place } from '@/types/place.types'

interface AutocompleteResponse {
  query: string
  places: Place[]
}

// TODO: Use this to dynamically update search radius based on geometry
// We need to use a small radius for point nodes, but larger radius for areas eg. university campuses or parks
// function calculateSearchRadius(place: OsmPlace): number {
//   // For points (nodes), use default radius
//   if (place.type === 'node' || !place.bounds) {
//     return DEFAULT_SEARCH_RADIUS
//   }

//   // For areas (ways/relations), calculate the diagonal distance of the bounding box
//   // Calculate the area's diagonal distance using the southwest and northeast corners
//   const sw = turf.point([place.bounds.minlon, place.bounds.minlat])
//   const ne = turf.point([place.bounds.maxlon, place.bounds.maxlat])
//   const diagonalDistance = turf.distance(sw, ne, { units: 'meters' })

//   // Use half the diagonal distance plus the default radius as search radius
//   // This ensures we cover the entire area plus a buffer
//   return diagonalDistance / 2 + DEFAULT_SEARCH_RADIUS
// }

function placeSearchService() {
  const loading = ref(false)
  const suggestions = ref<Place[]>([])
  const error = ref<string | null>(null)

  async function getAutocomplete(
    query: string,
    lat?: number,
    lng?: number,
    radius: number = 10000,
  ): Promise<Place[]> {
    if (!query || query.length < 2) {
      return []
    }

    loading.value = true
    error.value = null

    try {
      const params: Record<string, string | number> = {
        q: query,
        autocomplete: 'true',
      }

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
