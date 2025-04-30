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

  function getBookmarksStore() {
    return useBookmarksStore()
  }

  const getCollectionById = computed(() => {
    return (id: string) => {
      const collection = collections.value.find(
        collection => collection.id === id,
      )
      if (!collection) return undefined

      const result = { ...collection } as Collection & { places?: Bookmark[] }

      if (collection.bookmarkIds && collection.bookmarkIds.length > 0) {
        const bookmarksStore = getBookmarksStore()
        result.places = collection.bookmarkIds
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
    collection: Collection & { places?: Bookmark[] },
  ): NormalizedCollection {
    const { places, ...collectionData } = collection
    const normalizedCollection: NormalizedCollection = { ...collectionData }

    if (places && places.length > 0) {
      // Store the bookmark IDs
      normalizedCollection.bookmarkIds = places.map(place => place.id)

      // Store the actual bookmarks in the bookmarks store
      const bookmarksStore = getBookmarksStore()
      places.forEach(place => {
        // Check if bookmark exists directly in the bookmarks array
        const existingBookmark = bookmarksStore.bookmarks.find(
          bm => bm.id === place.id,
        )
        if (!existingBookmark) {
          bookmarksStore.addBookmark(place)
        } else {
          bookmarksStore.updateBookmark(place.id, place)
        }
      })
    }

    return normalizedCollection
  }

  function setCollections(
    newCollections: (Collection & { places?: Bookmark[] })[],
  ) {
    const normalizedCollections = newCollections.map(collection =>
      normalizeCollection(collection),
    )
    collections.value = normalizedCollections
  }

  function addCollection(collection: Collection & { places?: Bookmark[] }) {
    const normalizedCollection = normalizeCollection(collection)
    collections.value = [...collections.value, normalizedCollection]
  }

  function updateCollection(
    id: string,
    updatedCollection: Collection & { places?: Bookmark[] },
  ) {
    const index = collections.value.findIndex(
      collection => collection.id === id,
    )
    if (index !== -1) {
      const normalizedCollection = normalizeCollection(updatedCollection)
      collections.value[index] = normalizedCollection
    }
  }

  function removeCollection(id: string) {
    collections.value = collections.value.filter(
      collection => collection.id !== id,
    )
  }

  return {
    collections,
    getCollectionById,
    setCollections,
    addCollection,
    updateCollection,
    removeCollection,
    normalizeCollection, // Export this function for use in services
  }
})
