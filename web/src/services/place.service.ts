import { ref } from 'vue'
import { createSharedComposable } from '@vueuse/core'
import axios from 'axios'
import { useAppService } from '@/services/app.service'
import { api } from '@/lib/api'
import type { Place } from '@/types/place.types'
import type { Bookmark } from '@/types/library.types'
import type { SourceId } from '@/types/place.types'
import { SOURCE } from '@/lib/constants'
import { useSearchStore } from '@/stores/search.store'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'

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
    source: SourceId = SOURCE.OSM,
    options?: {
      name?: string
      lat?: number
      lng?: number
      radius?: number
    },
    signal?: AbortSignal,
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
        signal,
      })

      currentPlace.value = response.data
      return response.data
    } catch (e) {
      if (axios.isCancel(e)) return null
      console.error('Error fetching place details:', e)
      toast.error(e instanceof Error ? e.message : 'An error occurred')
      currentPlace.value = null
      return null
    } finally {
      loading.value = false
    }
  }

  /**
   * Find a bookmark matching the place's external IDs
   */
  function findBookmarkPlace(partialPlace: Partial<Place>): Partial<Place> | undefined {
    if (!partialPlace.externalIds) return undefined
    const bookmarksStore = useBookmarksStore()
    const bookmark = bookmarksStore.bookmarks.find(b =>
      Object.entries(partialPlace.externalIds!).some(
        ([provider, id]) => b.externalIds[provider] === id,
      ),
    )
    if (!bookmark) return undefined

    const now = new Date().toISOString()
    return {
      ...partialPlace,
      name: bookmark.name
        ? { value: bookmark.name, sourceId: 'local', timestamp: now }
        : partialPlace.name,
      address: bookmark.address
        ? { value: { formatted: bookmark.address }, sourceId: 'local', timestamp: now }
        : partialPlace.address,
      geometry: {
        value: {
          type: 'point',
          center: { lat: bookmark.lat, lng: bookmark.lng },
        },
        sourceId: 'local',
        timestamp: now,
      },
    }
  }

  /**
   * Set partial place data immediately (for progressive loading).
   * Checks the search store and bookmarks store for cached place data.
   */
  function setPartialPlace(partialPlace: Partial<Place>) {
    if (partialPlace.id) {
      const cached = findCachedPlace(partialPlace.id)
      if (cached) {
        currentPlace.value = cached
        return
      }
    }

    const enriched = findBookmarkPlace(partialPlace)
    currentPlace.value = enriched ?? partialPlace
  }

  /**
   * Fetch place details by coordinates with enrichment
   */
  async function fetchPlaceDetailsByCoordinates(
    lat: number,
    lng: number,
    options?: { radius?: number },
    signal?: AbortSignal,
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
        signal,
      })

      currentPlace.value = response.data
      return response.data
    } catch (e) {
      if (axios.isCancel(e)) return null
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
