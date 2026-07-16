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
import { usePlaceCacheStore, buildPlaceCacheKey } from '@/stores/place-cache.store'
import { useRecentsStore } from '@/stores/recents.store'

function placeService() {
  const currentPlace = ref<Partial<Place> | null>(null)
  const loading = ref(false)
  const { toast } = useAppService()
  const placeCache = usePlaceCacheStore()

  /**
   * Log a foreground place resolve into the user's (encrypted) recents.
   * Best-effort: recents must never block or break place loading.
   */
  function recordPlaceView(place: Partial<Place> | null) {
    if (!place) return
    try {
      useRecentsStore().recordPlace(place)
    } catch (e) {
      console.warn('Failed to record recently-viewed place:', e)
    }
  }

  /**
   * Look up a place in the local search results store by ID
   */
  function findCachedPlace(placeId: string): Place | undefined {
    const searchStore = useSearchStore()
    return searchStore.searchResults.find(p => p.id === placeId)
  }

  /**
   * Issue the actual GET against /places/details and write the response into
   * the place cache. Centralised so foreground fetches and SWR background
   * revalidations share the same request shape.
   */
  async function fetchPlaceFromApi(
    cacheKey: string,
    queryParams: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Place | null> {
    const response = await api.get<Place>('/places/details', {
      params: queryParams,
      signal,
    })
    placeCache.set(cacheKey, response.data)
    return response.data
  }

  /**
   * Stale-while-revalidate fetch shared by both the source/id and
   * coordinate lookup paths.
   *
   *   - Cache hit: render cached data immediately, kick off a background
   *     fetch if the entry is stale (don't block the UI on it).
   *   - Cache miss: foreground fetch with `loading=true`, surface errors
   *     via toast, fall back to `null` on failure.
   *
   * The shared `loading` ref is also reset to `false` on cache hit — a
   * rapid navigation could otherwise leave it stuck `true` from a prior
   * in-flight call.
   */
  async function fetchPlaceWithCache(
    queryParams: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Place | null> {
    const cacheKey = buildPlaceCacheKey(queryParams)
    const cached = placeCache.get(cacheKey)

    if (cached) {
      currentPlace.value = cached.data
      loading.value = false
      recordPlaceView(cached.data)
      if (placeCache.isStale(cached)) {
        // Background revalidate — don't await. UI keeps cached render until
        // the fresh response lands. Errors are swallowed (no toast) since
        // we're updating content the user is already seeing.
        fetchPlaceFromApi(cacheKey, queryParams, signal)
          .then(fresh => {
            if (fresh) currentPlace.value = fresh
          })
          .catch(e => {
            if (!axios.isCancel(e)) {
              console.warn('Place revalidation failed:', e)
            }
          })
      }
      return cached.data
    }

    loading.value = true
    try {
      const data = await fetchPlaceFromApi(cacheKey, queryParams, signal)
      currentPlace.value = data ?? null
      recordPlaceView(data)
      return data
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
    let queryParams: Record<string, string>

    if (source && id) {
      queryParams = { source, id }
    } else if (
      options?.name &&
      options?.lat !== undefined &&
      options?.lng !== undefined
    ) {
      queryParams = {
        name: options.name,
        lat: options.lat.toString(),
        lng: options.lng.toString(),
      }
      if (options.radius) queryParams.radius = options.radius.toString()
    } else {
      throw new Error(
        'Invalid parameters. Provide either source+id or name+lat+lng',
      )
    }

    return fetchPlaceWithCache(queryParams, signal)
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
    const queryParams: Record<string, string> = {
      lat: lat.toString(),
      lng: lng.toString(),
    }
    if (options?.radius) queryParams.radius = options.radius.toString()

    return fetchPlaceWithCache(queryParams, signal)
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
            // Server's column is NOT NULL with a default — older bookmark
            // payloads from the API may still arrive without the field
            // until the next refetch, so coerce to the schema default.
            iconPack: bookmark.iconPack ?? 'lucide',
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
