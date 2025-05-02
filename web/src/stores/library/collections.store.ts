import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useStorage } from '@vueuse/core'
import type { Collection, Bookmark } from '@/types/library.types'
import { useBookmarksStore } from './bookmarks.store'

interface NormalizedCollection extends Omit<Collection, 'places'> {
  bookmarkIds?: string[]
}

// TODO: Use pinia-orm to normalize collections and bookmarks data

export const useCollectionsStore = defineStore('collections', () => {
  const collections = useStorage<NormalizedCollection[]>('collections', [])

  const getCollectionById = computed(() => {
    return (id: string) => {
      const collection = collections.value.find(
        collection => collection.id === id,
      )
      if (!collection) return undefined

      const result = { ...collection } as Collection & {
        bookmarks?: Bookmark[]
      }

      // Hydrate the bookmarks
      if (collection.bookmarkIds && collection.bookmarkIds.length > 0) {
        const bookmarksStore = useBookmarksStore()
        result.bookmarks = collection.bookmarkIds
          .map(id => {
            return bookmarksStore.bookmarks.find(bm => bm.id === id)
          })
          .filter(bookmark => bookmark !== undefined) as Bookmark[]
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
    const normalizedCollections = newCollections.map(collection =>
      normalizeCollection(collection),
    )
    collections.value = normalizedCollections
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

  function updateBookmarkCollections(
    bookmarkId: string,
    newCollectionIds: string[],
  ) {
    const collection = collections.value.find(c =>
      c.bookmarkIds?.includes(bookmarkId),
    )
    if (collection) {
      collection.bookmarkIds = newCollectionIds
    }
  }

  return {
    collections,
    getCollectionById,
    setCollections,
    updateCollection,
    removeCollection,
    removeBookmarkFromCollections,
    addBookmarkToCollection,
    removeBookmarkFromSingleCollection,
    updateBookmarkCollections,
    normalizeCollection,
  }
})
