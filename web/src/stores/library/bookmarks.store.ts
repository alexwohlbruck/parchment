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

  function setBookmarks(places: Bookmark[]) {
    bookmarks.value = places
  }

/**
   * Merge an incoming row over the stored one, keeping `collectionIds` when
   * the incoming row doesn't carry any.
   *
   * Not every endpoint returns membership — `GET /collections/:id` embeds bare
   * bookmark rows, for instance — and the type documents absent as "membership
   * unknown", not "belongs to nothing". Overwriting wholesale meant that
   * merely opening a collection erased what its places belonged to, which the
   * map reads as unfiled: they'd jump to the Unfiled toggle and lose their
   * collection's icon and colour until the next full fetch.
   */
  function mergeBookmark(incoming: Bookmark, existing: Bookmark | undefined) {
    if (!existing || incoming.collectionIds) return incoming
    return existing.collectionIds
      ? { ...incoming, collectionIds: existing.collectionIds }
      : incoming
  }

  function addBookmark(place: Bookmark) {
    // Idempotent by id: the same bookmark can arrive twice — once from the
    // direct create call and again from its own `bookmark:created` realtime
    // echo — so replace an existing row instead of appending a duplicate.
    const index = bookmarks.value.findIndex(b => b.id === place.id)
    if (index !== -1) {
      bookmarks.value[index] = mergeBookmark(place, bookmarks.value[index])
    } else {
      bookmarks.value = [...bookmarks.value, place]
    }
  }

  function updateBookmark(
    id: string,
    updatedPlace: Bookmark & { collectionIds?: string[] },
  ) {
    const index = bookmarks.value.findIndex(place => place.id === id)
    if (index !== -1) {
      bookmarks.value[index] = mergeBookmark(updatedPlace, bookmarks.value[index])
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
    setBookmarks,
    addBookmark,
    updateBookmark,
    removeBookmark,
  }
})
