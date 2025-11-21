import { createSharedComposable } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useCollectionsStore } from '@/stores/library/collections.store'
import type { Place } from '@/types/place.types'
import type { CreateBookmarkParams, Bookmark } from '@/types/library.types'
import { ref } from 'vue'
import { api } from '@/lib/api'

// TODO: i18n error messages

export const useBookmarksService = createSharedComposable(() => {
  const bookmarksStore = useBookmarksStore()
  const collectionsStore = useCollectionsStore()
  const { t } = useI18n()
  const isSaving = ref(false)

  async function createBookmark(place: Place, collectionIds?: string[]) {
    if (!place.externalIds?.osm) {
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

    try {
      const params: CreateBookmarkParams & { collectionIds?: string[] } = {
        externalIds: place.externalIds,
        name: place.name.value || '',
        address: place.address?.value.formatted,
        lat: geometry.center.lat,
        lng: geometry.center.lng,
        collectionIds,
      }

      const response = await api.post('/library/bookmarks', params)
      const bookmark = response.data

      bookmarksStore.addBookmark(bookmark)
      toast.success(
        t('services.bookmarks.saveSuccess', { name: place.name.value }),
      )

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
  ): Promise<Bookmark | null> {
    try {
      // Use PUT method again
      const response = await api.put(`/library/bookmarks/${id}`, updates)

      if (response && response.status === 200 && response.data) {
        // Added or removed collection-bookmark relations
        const updatedBookmark = response.data
        bookmarksStore.updateBookmark(id, updatedBookmark)
        toast.success(t('services.bookmarks.updateSuccess'))
        return updatedBookmark
      } else if (response && response.status === 204) {
        // Completely removed bookmark from all collections
        const bookmarkToRemove = bookmarksStore.getBookmarkById(id)
        const name = bookmarkToRemove?.name || t('library.entities.bookmark')
        bookmarksStore.removeBookmark(id)
        toast.success(t('services.bookmarks.unsaveSuccess', { name }))
        return null
      } else {
        console.warn('Unexpected success status:', response?.status)
        bookmarksStore.removeBookmark(id)
        toast.error(t('services.bookmarks.updateError'))
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
      await api.delete(`/library/bookmarks/${bookmarkId}/collections`, {
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
      bookmark => bookmark.id === bookmark.id,
    )
  }

  return {
    isSaving,
    createBookmark,
    updateBookmark,
    removeBookmark,
    isBookmarkSaved,
  }
})
