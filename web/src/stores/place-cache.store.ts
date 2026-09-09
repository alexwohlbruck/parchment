import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Place } from '@/types/place.types'

interface CachedPlace {
  data: Place
  fetchedAt: number
}

const MAX_SIZE = 50
const STALE_TTL_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Keyed cache of place-detail responses. Used by `placeService` to render
 * previously-visited places instantly while a background revalidation pulls
 * any updates (stale-while-revalidate).
 *
 * Two indexing forms are kept per entry so a place fetched one way (e.g. by
 * OSM id) can be served on revisit via another lookup (e.g. coordinates) —
 * both keys point at the same `CachedPlace` record so updates propagate.
 *
 * Eviction is LRU on the request-key map: re-setting a key moves it to the
 * end, and the oldest entry is dropped once the cap is hit.
 *
 * Widget data is intentionally NOT cached here. The Place response carries
 * `widget descriptors`, but the widget *payloads* are fetched separately
 * by `useWidgets` on each mount, which is desired for real-time data
 * (transit departures, etc.).
 */
export const usePlaceCacheStore = defineStore('placeCache', () => {
  // request-key → record (used for LRU iteration order)
  const byRequestKey = ref(new Map<string, CachedPlace>())
  // place.id → record (for cross-lookup hits)
  const byPlaceId = ref(new Map<string, CachedPlace>())

  function get(requestKey: string, placeId?: string): CachedPlace | null {
    const direct = byRequestKey.value.get(requestKey)
    if (direct) return direct
    if (placeId) return byPlaceId.value.get(placeId) ?? null
    return null
  }

  function set(requestKey: string, place: Place) {
    const record: CachedPlace = { data: place, fetchedAt: Date.now() }

    // Re-set on the request map promotes recency for LRU.
    byRequestKey.value.delete(requestKey)
    byRequestKey.value.set(requestKey, record)

    if (place.id) byPlaceId.value.set(place.id, record)

    while (byRequestKey.value.size > MAX_SIZE) {
      const oldestKey = byRequestKey.value.keys().next().value
      if (oldestKey === undefined) break
      const evicted = byRequestKey.value.get(oldestKey)
      byRequestKey.value.delete(oldestKey)
      // Drop the placeId index too, but only if it still points at the
      // evicted record — a newer entry may share the same place id.
      if (evicted?.data.id) {
        const current = byPlaceId.value.get(evicted.data.id)
        if (current === evicted) byPlaceId.value.delete(evicted.data.id)
      }
    }
  }

  function isStale(entry: CachedPlace): boolean {
    return Date.now() - entry.fetchedAt > STALE_TTL_MS
  }

  function clear() {
    byRequestKey.value.clear()
    byPlaceId.value.clear()
  }

  return { get, set, isStale, clear }
})

/**
 * Build a stable cache key from a query-param map. Sorted to make
 * argument-order changes irrelevant.
 */
export function buildPlaceCacheKey(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&')
}
