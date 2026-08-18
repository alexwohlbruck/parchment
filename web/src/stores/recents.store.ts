/**
 * Reactive facade over the E2EE recents kinds.
 *
 * Components read the `searches` / `places` refs; call sites (search commit,
 * place view) call `recordSearch` / `recordPlace`. The underlying encryption,
 * dedupe, capping, and debounced sync live in `lib/recents`. Recents are
 * per-user and end-to-end encrypted, so everything is a no-op when signed out.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Place } from '@/types/place.types'
import { formatAddress } from '@/lib/place.utils'
import { useAuthStore } from '@/stores/auth.store'
import {
  recentSearches,
  recentPlaces,
  type RecentSearchEntry,
  type RecentPlaceEntry,
} from '@/lib/recents'

/** Build a compact recent-place entry from a resolved (possibly partial) place. */
function toRecentPlaceEntry(place: Partial<Place>): RecentPlaceEntry | null {
  if (!place.id) return null

  const named = place.name?.value ?? null
  const address = formatAddress(place as Place)
  const center = place.geometry?.value?.center
  const coordLabel =
    center && Number.isFinite(center.lat) && Number.isFinite(center.lng)
      ? `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`
      : undefined

  const title = named || address || coordLabel || 'Location'
  const subtitle = named
    ? address || undefined
    : place.description?.value || undefined

  return {
    id: place.id,
    title,
    subtitle,
    icon: place.icon?.icon,
    iconPack: place.icon?.iconPack,
    category: place.icon?.category,
    lat: center?.lat,
    lng: center?.lng,
    at: Date.now(),
  }
}

export const useRecentsStore = defineStore('recents', () => {
  const authStore = useAuthStore()

  const searches = ref<RecentSearchEntry[]>([])
  const places = ref<RecentPlaceEntry[]>([])

  const currentUserId = () => authStore.me?.id ?? null

  /**
   * Ensure the given kind has been loaded from the server at least once.
   *
   * Callers fire these on every palette open / dashboard mount, so the work is
   * memoized per user: the first call owns the fetch+decrypt and every later
   * one gets that same promise back without touching the refs again. Leaving
   * the refs alone matters — a re-assignment is a new array identity, which
   * would re-trigger any watcher that reloads a list from the store and loop.
   *
   * A failed hydrate (offline, locked keys) clears the memo so the next call
   * retries, and never rejects: recents are an enhancement, and a caller that
   * awaited a rejection would lose the rest of its list with them.
   */
  type Hydration = { userId: string; promise: Promise<void> } | null
  const hydrations: Record<'searches' | 'places', Hydration> = {
    searches: null,
    places: null,
  }

  function hydrateOnce(
    kind: 'searches' | 'places',
    load: (userId: string) => Promise<void>,
  ): Promise<void> {
    const userId = currentUserId()
    if (!userId) return Promise.resolve()

    const inFlight = hydrations[kind]
    if (inFlight?.userId === userId) return inFlight.promise

    const promise = load(userId).catch(err => {
      console.warn(`[recents:${kind}] hydrate failed, will retry:`, err)
      hydrations[kind] = null
    })
    hydrations[kind] = { userId, promise }
    return promise
  }

  function ensureSearchesHydrated(): Promise<void> {
    return hydrateOnce('searches', async userId => {
      searches.value = await recentSearches.hydrate(userId)
    })
  }

  function ensurePlacesHydrated(): Promise<void> {
    return hydrateOnce('places', async userId => {
      places.value = await recentPlaces.hydrate(userId)
    })
  }

  function recordSearch(query: string) {
    const userId = currentUserId()
    if (!userId) return
    const trimmed = query.trim()
    if (!trimmed) return
    recentSearches.record({ query: trimmed, kind: 'text', at: Date.now() }, userId)
    searches.value = recentSearches.list()
  }

  /** Record a POI category search (e.g. "Bicycle Parking") so it re-runs the category, not a text query. */
  function recordCategorySearch(
    categoryId: string,
    name: string,
    icon?: { iconName?: string; iconPack?: 'lucide' | 'maki'; iconCategory?: string },
  ) {
    const userId = currentUserId()
    if (!userId) return
    const id = categoryId?.trim()
    const label = name?.trim()
    if (!id || !label) return
    recentSearches.record(
      {
        query: label,
        kind: 'category',
        categoryId: id,
        iconName: icon?.iconName,
        iconPack: icon?.iconPack,
        iconCategory: icon?.iconCategory,
        at: Date.now(),
      },
      userId,
    )
    searches.value = recentSearches.list()
  }

  /** Record a brand search (e.g. "McDonald's") so it re-runs the brand browse. */
  function recordBrandSearch(
    brandKey: string,
    name: string,
    brandName?: string,
    logoUrl?: string,
  ) {
    const userId = currentUserId()
    if (!userId) return
    const key = brandKey?.trim()
    const label = name?.trim()
    if (!key || !label) return
    recentSearches.record(
      {
        query: label,
        kind: 'brand',
        brandKey: key,
        brandName: brandName?.trim() || label,
        brandLogoUrl: logoUrl,
        iconName: 'Store',
        at: Date.now(),
      },
      userId,
    )
    searches.value = recentSearches.list()
  }

  function recordPlace(place: Partial<Place>) {
    const userId = currentUserId()
    if (!userId) return
    const entry = toRecentPlaceEntry(place)
    if (!entry) return
    recentPlaces.record(entry, userId)
    places.value = recentPlaces.list()
  }

  async function clearSearches() {
    const userId = currentUserId()
    if (!userId) return
    await recentSearches.clear(userId)
    searches.value = []
  }

  async function clearPlaces() {
    const userId = currentUserId()
    if (!userId) return
    await recentPlaces.clear(userId)
    places.value = []
  }

  return {
    searches,
    places,
    ensureSearchesHydrated,
    ensurePlacesHydrated,
    recordSearch,
    recordCategorySearch,
    recordBrandSearch,
    recordPlace,
    clearSearches,
    clearPlaces,
  }
})
