import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { useStorage } from '@vueuse/core'
import type { Collection, Bookmark } from '@/types/library.types'
import { isOfflineId } from '@/lib/sync/offline-id'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useEncryptedPointsStore } from '@/stores/library/encrypted-points.store'
import { pointAsBookmark } from '@/lib/library/collection-points'

interface NormalizedCollection extends Omit<Collection, 'places'> {
  bookmarkIds?: string[]
}

// TODO: Use pinia-orm to normalize collections and bookmarks data

export const useCollectionsStore = defineStore('collections', () => {
  const collections = useStorage<NormalizedCollection[]>('collections', [])

  // Per-device: id of the most recent collection the user saved a bookmark
  // to. Drives the bookmark button's default target (tooltip / icon / color)
  // and the clock badge in the collection picker. `null` when the user has
  // never saved on this device — the picker opens instead of one-tap save.
  const lastSavedCollectionId = useStorage<string | null>(
    'last-saved-collection-id',
    null,
  )

  function setLastSavedCollectionId(id: string | null) {
    lastSavedCollectionId.value = id
  }

  /** The collection whose page is open, which the map draws in full. */
  const openCollectionId = ref<string | null>(null)

  const getCollectionById = computed(() => {
    return (id: string) => {
      const collection = collections.value.find(
        collection => collection.id === id,
      )
      if (!collection) return undefined

      const result = { ...collection } as Collection & {
        bookmarks?: Bookmark[]
      }

      // Hydrate the bookmarks from both sides of the relation. A
      // collection whose contents were never opened has no `bookmarkIds`,
      // but the bookmarks themselves know what they belong to — offline
      // that's the only way its places can be listed at all. Ordering
      // follows `bookmarkIds` (the server's order) with anything known
      // only from the bookmark side appended.
      const bookmarksStore = useBookmarksStore()
      const ordered = (collection.bookmarkIds ?? [])
        .map(bookmarkId =>
          bookmarksStore.bookmarks.find(bm => bm.id === bookmarkId),
        )
        .filter((bookmark): bookmark is Bookmark => bookmark !== undefined)

      const seen = new Set(ordered.map(bookmark => bookmark.id))
      const fromBookmarks = bookmarksStore.bookmarks.filter(
        bookmark =>
          !seen.has(bookmark.id) &&
          bookmark.collectionIds?.includes(collection.id),
      )

      if (ordered.length > 0 || fromBookmarks.length > 0) {
        result.bookmarks = [...ordered, ...fromBookmarks]
      }

      return result
    }
  })

  // Normalize a collection when storing it
  function normalizeCollection(
    collection: Collection & { bookmarks?: Bookmark[] },
  ): NormalizedCollection {
    const { bookmarks, ...collectionData } = collection
    const normalizedCollection: NormalizedCollection = { ...collectionData }

    if (bookmarks && bookmarks.length > 0) {
      normalizedCollection.bookmarkIds = bookmarks.map(bookmark => bookmark.id)

      const bookmarksStore = useBookmarksStore()
      bookmarks.forEach(bookmark => {
        const existingBookmark = bookmarksStore.bookmarks.find(
          bm => bm.id === bookmark.id,
        )
        if (!existingBookmark) {
          bookmarksStore.addBookmark(bookmark)
        } else {
          bookmarksStore.updateBookmark(bookmark.id, bookmark)
        }
      })
    }

    return normalizedCollection
  }

  function setCollections(
    newCollections: (Collection & { bookmarks?: Bookmark[] })[],
  ) {
    // Carry offline-created bookmark links over the refresh: the server
    // can't return what its queue hasn't received yet.
    const previousById = new Map(collections.value.map(c => [c.id, c]))
    const normalizedCollections = newCollections.map(collection => {
      const normalized = normalizeCollection(collection)
      const offlineIds =
        previousById
          .get(normalized.id)
          ?.bookmarkIds?.filter(
            id => isOfflineId(id) && !normalized.bookmarkIds?.includes(id),
          ) ?? []
      if (offlineIds.length > 0) {
        normalized.bookmarkIds = [
          ...(normalized.bookmarkIds ?? []),
          ...offlineIds,
        ]
      }
      return normalized
    })
    collections.value = normalizedCollections
  }

  /** Swap an offline temp bookmark id for its server id everywhere. */
  function remapBookmarkId(oldId: string, newId: string) {
    if (oldId === newId) return
    collections.value.forEach(collection => {
      if (!collection.bookmarkIds?.includes(oldId)) return
      collection.bookmarkIds = collection.bookmarkIds.map(id =>
        id === oldId ? newId : id,
      )
    })
  }

  // Add or update a collection
  function updateCollection(
    collection: Collection & { bookmarks?: Bookmark[] }, // Renamed param for clarity
  ) {
    const normalizedCollection = normalizeCollection(collection)
    const index = collections.value.findIndex(c => c.id === collection.id)

    if (index !== -1) {
      collections.value[index] = normalizedCollection
    } else {
      collections.value.push(normalizedCollection)
    }
  }

  function removeBookmarkFromCollections(bookmarkId: string) {
    collections.value.forEach(collection => {
      if (collection.bookmarkIds?.includes(bookmarkId)) {
        collection.bookmarkIds = collection.bookmarkIds.filter(
          id => id !== bookmarkId,
        )
      }
    })
  }

  function removeCollection(id: string) {
    collections.value = collections.value.filter(c => c.id !== id)
    // A deleted collection can't be the "last saved to" target anymore;
    // clear the pointer so the button falls back to opening the picker.
    if (lastSavedCollectionId.value === id) {
      lastSavedCollectionId.value = null
    }
  }

  function addBookmarkToCollection(collectionId: string, bookmark: Bookmark) {
    const collection = collections.value.find(c => c.id === collectionId)
    if (collection) {
      if (!collection.bookmarkIds) {
        collection.bookmarkIds = []
      }
      collection.bookmarkIds.push(bookmark.id)

      const bookmarksStore = useBookmarksStore()
      const existingBookmark = bookmarksStore.bookmarks.find(
        bm => bm.id === bookmark.id,
      )
      if (!existingBookmark) {
        bookmarksStore.addBookmark(bookmark)
      } else {
        bookmarksStore.updateBookmark(bookmark.id, bookmark)
      }
    }
  }

  function removeBookmarkFromSingleCollection(
    collectionId: string,
    bookmarkId: string,
  ) {
    const collection = collections.value.find(c => c.id === collectionId)
    if (collection && collection.bookmarkIds) {
      collection.bookmarkIds = collection.bookmarkIds.filter(
        id => id !== bookmarkId,
      )
    }
  }

  /**
   * Which collections a bookmark belongs to, from local state alone.
   *
   * Both sides of the relation are stored — `collection.bookmarkIds` and
   * `bookmark.collectionIds` — and neither is complete on its own: a
   * collection whose contents were never opened has no `bookmarkIds`, and a
   * bookmark row from a single-bookmark response has no `collectionIds`.
   * Union them, and keep only ids we actually hold a collection for.
   */
  function getCollectionIdsForBookmark(bookmarkId: string): string[] {
    const fromCollections = collections.value
      .filter(c => c.bookmarkIds?.includes(bookmarkId))
      .map(c => c.id)

    const bookmarksStore = useBookmarksStore()
    const fromBookmark =
      bookmarksStore.getBookmarkById(bookmarkId)?.collectionIds ?? []

    const known = new Set(collections.value.map(c => c.id))
    return [...new Set([...fromCollections, ...fromBookmark])].filter(id =>
      known.has(id),
    )
  }

  /**
   * Set a bookmark's collection membership, syncing both sides of the
   * relation.
   *
   * This used to find the first collection containing the bookmark and
   * assign `bookmarkIds = newCollectionIds` — writing collection ids into a
   * list of bookmark ids, so one membership change corrupted a collection's
   * contents. It went unnoticed while the picker asked the server for
   * membership; offline it has to be right, because local state is the only
   * source there is.
   */
  function updateBookmarkCollections(
    bookmarkId: string,
    newCollectionIds: string[],
  ) {
    collections.value.forEach(collection => {
      const shouldContain = newCollectionIds.includes(collection.id)
      const contains = collection.bookmarkIds?.includes(bookmarkId) ?? false
      if (shouldContain && !contains) {
        collection.bookmarkIds = [...(collection.bookmarkIds ?? []), bookmarkId]
      } else if (!shouldContain && contains) {
        collection.bookmarkIds = collection.bookmarkIds!.filter(
          id => id !== bookmarkId,
        )
      }
    })
  }

  /**
   * The places in a collection, whichever way it stores them. A private
   * collection's only exist once its points are decrypted this session.
   */
  /** A collection opened by public link: not in the library, but on the map. */
  const publicCollection = shallowRef<{ id: string; places: Bookmark[] } | null>(null)

  const getCollectionPlaces = computed(() => {
    const pointsStore = useEncryptedPointsStore()
    return (id: string): Bookmark[] => {
      if (publicCollection.value?.id === id) return publicCollection.value.places
      const collection = getCollectionById.value(id)
      if (!collection) return []
      if (collection.scheme !== 'user-e2ee') return collection.bookmarks ?? []
      return pointsStore
        .getPoints(id)
        .map(point => pointAsBookmark(point, collection.userId))
    }
  })

  return {
    collections,
    lastSavedCollectionId,
    getCollectionPlaces,
    publicCollection,
    setLastSavedCollectionId,
    openCollectionId,
    getCollectionById,
    setCollections,
    updateCollection,
    remapBookmarkId,
    getCollectionIdsForBookmark,
    removeCollection,
    removeBookmarkFromCollections,
    addBookmarkToCollection,
    removeBookmarkFromSingleCollection,
    updateBookmarkCollections,
    normalizeCollection,
  }
})
