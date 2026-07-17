import { createSharedComposable } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useCategoryPaletteStore } from '@/stores/category-palette.store'
import { useThemeStore } from '@/stores/theme.store'
import type { Place } from '@/types/place.types'
import type { CreateBookmarkParams, Bookmark } from '@/types/library.types'
import { ref } from 'vue'
import { api } from '@/lib/api'
import { closestThemeColor } from '@/lib/utils'
import { AppRoute } from '@/router'
import {
  FREQUENT_META,
  isCanonicalFrequent,
  type FrequentType,
} from '@/lib/frequents'

// TODO: i18n error messages

export const useBookmarksService = createSharedComposable(() => {
  const bookmarksStore = useBookmarksStore()
  const collectionsStore = useCollectionsStore()
  const categoryPaletteStore = useCategoryPaletteStore()
  const themeStore = useThemeStore()
  const router = useRouter()
  const { t } = useI18n()
  const isSaving = ref(false)

  // Toast helper: builds the optional "View" action button that takes
  // the user to the collection they just added a bookmark to. Returns
  // undefined when there's no resolvable target (so the toast renders
  // without an action) instead of a no-op button.
  function viewCollectionAction(collectionId: string | undefined) {
    if (!collectionId) return undefined
    return {
      label: t('general.view'),
      onClick: () => {
        router.push({ name: AppRoute.COLLECTION, params: { id: collectionId } })
      },
    }
  }

  // Remember the most recently written-to collection so the bookmark
  // button can target it directly on the next save. Last-write-wins across
  // both new bookmarks and picker toggles.
  function rememberLastSaved(collectionIds: string[] | undefined) {
    if (!collectionIds || collectionIds.length === 0) return
    collectionsStore.setLastSavedCollectionId(
      collectionIds[collectionIds.length - 1],
    )
  }

  async function createBookmark(
    place: Place,
    collectionIds?: string[],
    options: {
      frequentType?: FrequentType
      silent?: boolean
      /** Override the bookmark name (used for custom frequents). */
      name?: string
      /** Override the icon/colour (used to stamp a canonical frequent's icon). */
      icon?: string
      iconPack?: 'lucide' | 'maki'
      iconColor?: string
    } = {},
  ) {
    if (!place.externalIds || Object.keys(place.externalIds).length === 0) {
      toast.error(t('services.bookmarks.saveErrorNoOsmId'))
      return null
    }

    // Extract coordinates from place geometry
    const geometry = place.geometry?.value
    if (!geometry || !geometry.center) {
      toast.error(t('services.bookmarks.saveErrorNoCoordinates'))
      return null
    }

    isSaving.value = true

    // Pre-fill the bookmark's icon/color from the place's resolved
    // category icon when available. The server emits `place.icon` with
    // the maki/lucide name + the abstract category; we then snap the
    // category's CSS color to the closest discrete `ThemeColor` so it
    // matches what the picker offers. This avoids the "everything is a
    // map-pin in default-red" baseline for newly-saved places.
    const placeIcon = place.icon
    const categoryColorString = placeIcon?.category
      ? categoryPaletteStore.getCategoryColor(placeIcon.category, themeStore.isDark)
      : null
    const derivedIconColor = closestThemeColor(categoryColorString)

    try {
      const params: CreateBookmarkParams & { collectionIds?: string[] } = {
        externalIds: place.externalIds,
        name: options.name || place.name.value || '',
        address: place.address?.value.formatted,
        lat: geometry.center.lat,
        lng: geometry.center.lng,
        icon: options.icon ?? placeIcon?.icon,
        iconPack: options.iconPack ?? placeIcon?.iconPack,
        iconColor: options.iconColor ?? derivedIconColor,
        ...(options.frequentType ? { frequentType: options.frequentType } : {}),
        collectionIds,
      }

      const response = await api.post('/library/bookmarks', params)
      const bookmark = response.data

      bookmarksStore.addBookmark(bookmark)
      rememberLastSaved(collectionIds)

      // Preset saves surface their own "Set as Home" toast (handled by the
      // caller in `setFrequent`), so skip the generic "Saved to collection"
      // one here to avoid a double toast.
      if (options.silent) return bookmark

      // Last element of collectionIds is the one we want to surface in the
      // toast — that's the same collection we just pinned as the target for
      // the next one-tap save, so "Saved {name} to {collection}" matches
      // what the user just did. Fall back to a generic message if the
      // collection can't be resolved (e.g. stale cache).
      const targetId = collectionIds?.[collectionIds.length - 1]
      const target = targetId
        ? collectionsStore.getCollectionById(targetId)
        : undefined
      if (target) {
        toast.success(
          t('services.bookmarks.saveSuccessToCollection', {
            name: place.name.value,
            collection:
              target.name || t('library.entities.collections.untitled'),
          }),
          { action: viewCollectionAction(targetId) },
        )
      } else {
        toast.success(
          t('services.bookmarks.saveSuccess', { name: place.name.value }),
        )
      }

      return bookmark
    } catch (error) {
      toast.error(t('services.bookmarks.saveError'))
      return null
    } finally {
      isSaving.value = false
    }
  }

  // TODO: Clean this up
  async function updateBookmark(
    id: string,
    updates: Partial<Bookmark> & { collectionIds?: string[] },
    options: {
      silent?: boolean
      // ID of a collection the caller just ADDED this bookmark to —
      // used to render an "Added to X" toast with a View action that
      // jumps straight to that collection. Pass `undefined` for any
      // other update (rename, color change, removing a collection)
      // and the toast falls back to the generic "Bookmark updated".
      addedCollectionId?: string
    } = {},
  ): Promise<Bookmark | null> {
    try {
      // Use PUT method again
      const response = await api.put(`/library/bookmarks/${id}`, updates)

      if (response && response.status === 200 && response.data) {
        // Added or removed collection-bookmark relations
        const updatedBookmark = response.data
        bookmarksStore.updateBookmark(id, updatedBookmark)
        rememberLastSaved(updates.collectionIds)
        if (!options.silent) {
          const added = options.addedCollectionId
            ? collectionsStore.getCollectionById(options.addedCollectionId)
            : undefined
          if (added) {
            toast.success(
              t('library.actions.addedToCollection', {
                collection: added.name || t('library.entities.collections.untitled'),
              }),
              { action: viewCollectionAction(options.addedCollectionId) },
            )
          } else {
            toast.success(t('services.bookmarks.updateSuccess'))
          }
        }
        return updatedBookmark
      } else if (response && response.status === 204) {
        // Completely removed bookmark from all collections
        const bookmarkToRemove = bookmarksStore.getBookmarkById(id)
        const name =
          bookmarkToRemove?.name ||
          t('library.entities.bookmarks.title.singular')
        bookmarksStore.removeBookmark(id)
        if (!options.silent) {
          toast.success(t('services.bookmarks.unsaveSuccess', { name }))
        }
        return null
      } else {
        console.warn('Unexpected success status:', response?.status)
        bookmarksStore.removeBookmark(id)
        if (!options.silent) {
          toast.error(t('services.bookmarks.updateError'))
        }
        return null
      }
    } catch (error: any) {
      if (error.response && error.response.status === 404) {
        toast.error(t('services.bookmarks.updateErrorNotFound'))
        bookmarksStore.removeBookmark(id)
      } else {
        toast.error(t('services.bookmarks.updateError'))
      }
      console.error(`Error updating bookmark ${id}:`, error)
      return null
    }
  }

  // Removes a bookmark from specific collections
  async function removeBookmark(
    bookmarkId: string,
    collectionIds: string[],
    bookmarkName: string,
  ) {
    if (!collectionIds || collectionIds.length === 0) {
      console.warn('No collection IDs provided for removal.')
      return false
    }
    try {
      // Server route is `DELETE /library/bookmarks/:id` with the
      // collectionIds in the body. There's no `/collections` suffix —
      // the URL was inherited from a refactor that consolidated the
      // endpoints, and the wrong path silently 404s back.
      await api.delete(`/library/bookmarks/${bookmarkId}`, {
        data: { collectionIds },
      })

      collectionIds.forEach(collectionId => {
        collectionsStore.removeBookmarkFromSingleCollection(
          collectionId,
          bookmarkId,
        )
      })

      toast.success(
        t('services.bookmarks.removeFromCollectionSuccess', {
          name: bookmarkName,
        }),
      )
      return true
    } catch (error) {
      toast.error(t('services.bookmarks.removeFromCollectionError'))
      return false
    }
  }

  function isBookmarkSaved(bookmark: Bookmark) {
    if (!bookmark.id) return false

    return bookmarksStore.bookmarks.some(
      existing => existing.id === bookmark.id,
    )
  }

  // ── Frequents (Home / Work / School / Custom) ───────────────────────
  // Frequents are bookmarks tagged with `frequentType`. Unlike ordinary
  // bookmarks they are *standalone* — not linked to any collection — so they
  // have a dedicated fetch (`fetchFrequents`) since the collection hydrate
  // won't surface them. The same place can still be added to a collection
  // separately. A bookmark carries at most one `frequentType`.

  /** All bookmarks tagged with a frequent type, in save order. */
  function getFrequentBookmarks(): Bookmark[] {
    return bookmarksStore.bookmarks.filter(b => b.frequentType)
  }

  /** Load the user's standalone frequents from the server into the store. */
  async function fetchFrequents(): Promise<void> {
    try {
      const { data } = await api.get<Bookmark[]>('/library/bookmarks/frequents')
      for (const bm of data ?? []) bookmarksStore.addBookmark(bm)
    } catch (e) {
      console.warn('Failed to fetch frequents:', e)
    }
  }

  /**
   * Pick a collection to file a newly-created preset into. Prefers the most
   * recently used collection, else the first writable owned collection.
   * Returns null when the user has no writable collection at all.
   */
  function resolveDefaultCollectionId(): string | null {
    const writable = collectionsStore.collections.filter(
      c => !c.role || c.role === 'owner' || c.role === 'editor',
    )
    if (writable.length === 0) return null

    const lastSaved = collectionsStore.lastSavedCollectionId
    if (lastSaved && writable.some(c => c.id === lastSaved)) return lastSaved

    return writable[0].id
  }

  /** Find the id of an already-saved bookmark matching a place's externalIds. */
  function findBookmarkIdForPlace(place: Place): string | undefined {
    if (place.bookmark?.id) return place.bookmark.id
    const ids = place.externalIds
    if (!ids) return undefined
    return bookmarksStore.bookmarks.find(b =>
      Object.entries(ids).some(([provider, id]) => b.externalIds[provider] === id),
    )?.id
  }

  /**
   * Mark a place as a frequent (Home/Work/School/Custom). Updates the tag if
   * the place is already bookmarked; otherwise creates a bookmark in the
   * default collection.
   *
   * Canonical types (home/work/school) stamp their fixed icon + colour onto the
   * bookmark so it always looks the part. `custom` keeps the place's own icon
   * and takes an optional user-supplied `name` as its label.
   */
  async function setFrequent(
    place: Place,
    frequentType: FrequentType,
    opts: { name?: string } = {},
  ): Promise<Bookmark | null> {
    const targetBookmarkId = findBookmarkIdForPlace(place)

    // Stamp the canonical icon/colour so a Home always looks like a Home.
    const iconOverride = isCanonicalFrequent(frequentType)
      ? {
          icon: FREQUENT_META[frequentType].icon,
          iconPack: 'lucide' as const,
          iconColor: FREQUENT_META[frequentType].color,
        }
      : {}
    const name = opts.name?.trim() || undefined

    let result: Bookmark | null
    if (targetBookmarkId) {
      result = await updateBookmark(
        targetBookmarkId,
        { frequentType, ...iconOverride, ...(name ? { name } : {}) },
        { silent: true },
      )
    } else {
      // Frequents are standalone — created with no collection. The same place
      // can still be added to a collection separately.
      result = await createBookmark(place, [], {
        frequentType,
        silent: true,
        ...iconOverride,
        ...(name ? { name } : {}),
      })
    }

    if (result) {
      toast.success(
        t('services.bookmarks.frequentSet', {
          label: name || t(`library.types.${frequentType}`),
        }),
      )
    }
    return result
  }

  /** Remove the Home/Work/School tag from a specific bookmark. */
  async function clearFrequent(bookmarkId: string): Promise<void> {
    const current = bookmarksStore.getBookmarkById(bookmarkId)
    if (!current?.frequentType) return
    const label = t(`library.types.${current.frequentType}`)
    await updateBookmark(
      bookmarkId,
      { frequentType: null } as unknown as Partial<Bookmark>,
      { silent: true },
    )
    toast.success(t('services.bookmarks.frequentRemoved', { label }))
  }

  return {
    isSaving,
    createBookmark,
    updateBookmark,
    removeBookmark,
    isBookmarkSaved,
    getFrequentBookmarks,
    fetchFrequents,
    setFrequent,
    clearFrequent,
  }
})
