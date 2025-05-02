import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useStorage } from '@vueuse/core'
import type { Bookmark } from '@/types/library.types'
import { useCollectionsStore } from '@/stores/library/collections.store'

export const useBookmarksStore = defineStore('bookmarks', () => {
  const bookmarks = useStorage<Bookmark[]>('bookmarks', [])
  const collectionsStore = useCollectionsStore()
  const getBookmarkById = computed(() => {
    return (id: string) => bookmarks.value.find(place => place.id === id)
  })

  const getBookmarkByExternalId = computed(() => {
    return (provider: string, externalId: string) => {
      return bookmarks.value.find(place => {
        return place.externalIds[provider] === externalId
      })
    }
  })

  const isPlaceSaved = computed(() => {
    return (externalIds: Record<string, string>) => {
      return bookmarks.value.some(place => {
        return Object.entries(externalIds).some(([provider, id]) => {
          return place.externalIds[provider] === id
        })
      })
    }
  })

  function navigateToBookmark(bookmark: Bookmark) {
    const osmId = bookmark.externalIds.osm
    const osmType = bookmark.externalIds.osmType || 'node'

    if (osmId && osmType) {
      return {
        name: 'Place',
        params: { type: osmType, id: osmId },
      }
    }

    return null
  }

  function setBookmarks(places: Bookmark[]) {
    bookmarks.value = places
  }

  function addBookmark(place: Bookmark) {
    bookmarks.value = [...bookmarks.value, place]
  }

  function updateBookmark(
    id: string,
    updatedPlace: Bookmark & { collectionIds?: string[] },
  ) {
    const index = bookmarks.value.findIndex(place => place.id === id)
    if (index !== -1) {
      bookmarks.value[index] = updatedPlace
    }

    if (updatedPlace.collectionIds) {
      collectionsStore.updateBookmarkCollections(id, updatedPlace.collectionIds)
    }
  }

  function removeBookmark(id: string) {
    bookmarks.value = bookmarks.value.filter(place => place.id !== id)
  }

  return {
    bookmarks,
    getBookmarkById,
    getBookmarkByExternalId,
    isPlaceSaved,
    navigateToBookmark,
    setBookmarks,
    addBookmark,
    updateBookmark,
    removeBookmark,
  }
})
