import { ref } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import { useAppService } from '@/services/app.service'
import { api } from '@/lib/api'
import type { Place } from '@/types/place.types'
import type { Bookmark } from '@/types/library.types'
import type { SourceId } from '@/types/place.types'
import { useSearchStore } from '@/stores/search.store'

function placeService() {
  const currentPlace = ref<Partial<Place> | null>(null)
  const loading = ref(false)
  const { toast } = useAppService()

  /**
   * Look up a place in the local search results store by ID
   */
  function findCachedPlace(placeId: string): Place | undefined {
    const searchStore = useSearchStore()
    return searchStore.searchResults.find(p => p.id === placeId)
  }

  /**
   * Fetch place details using the new unified lookup endpoint
   */
  async function fetchPlaceDetails(
    id: string,
    source: SourceId = 'osm', // TODO: Use constants defs from server code
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
      if (source && id) {
        // Source-based lookup (OSM, Google, etc.)
        queryParams = {
          source,
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
          'Invalid parameters. Provide either source+id or name+lat+lng',
        )
      }

      const response = await api.get<Place>('/places/details', {
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
   * Set partial place data immediately (for progressive loading).
   * Checks the search store for cached place data and merges it.
   */
  function setPartialPlace(partialPlace: Partial<Place>) {
    if (partialPlace.id) {
      const cached = findCachedPlace(partialPlace.id)
      if (cached) {
        currentPlace.value = cached
        return
      }
    }
    currentPlace.value = partialPlace
  }

  /**
   * Fetch place details by coordinates with enrichment
   */
  async function fetchPlaceDetailsByCoordinates(
    lat: number,
    lng: number,
    options?: { radius?: number },
  ): Promise<Place | null> {
    loading.value = true

    try {
      const queryParams: Record<string, string> = {
        lat: lat.toString(),
        lng: lng.toString(),
      }

      if (options?.radius) {
        queryParams.radius = options.radius.toString()
      }

      const response = await api.get<Place>('/places/details', {
        params: queryParams,
      })

      currentPlace.value = response.data
      return response.data
    } catch (e) {
      console.error('Error fetching place details by coordinates:', e)
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

  function setBookmarkStatus(
    bookmark: Bookmark | null,
    collectionIds: string[] | null,
  ) {
    if (currentPlace.value) {
      // Convert date strings to Date objects before assigning
      const bookmarkToAssign = bookmark
        ? {
            ...bookmark,
            createdAt: new Date(bookmark.createdAt),
            updatedAt: new Date(bookmark.updatedAt),
            address: bookmark.address ?? null,
            presetType: bookmark.presetType ?? null,
          }
        : undefined

      currentPlace.value.bookmark = bookmarkToAssign
      currentPlace.value.collectionIds = collectionIds ?? undefined
    }
  }

  return {
    currentPlace,
    loading,
    fetchPlaceDetails,
    fetchPlaceDetailsByCoordinates,
    setPartialPlace,
    findCachedPlace,
    clearPlace,
    setBookmarkStatus,
  }
}

export const usePlaceService = createSharedComposable(placeService)
