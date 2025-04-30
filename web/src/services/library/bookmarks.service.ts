import { createSharedComposable } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import type { UnifiedPlace } from '@/types/unified-place.types'
import type { CreateBookmarkParams, Bookmark } from '@/types/library.types'
import { ref } from 'vue'
import { api } from '@/lib/api'

// TODO: i18n error messages

export const useBookmarksService = createSharedComposable(() => {
  const bookmarksStore = useBookmarksStore()
  const isSaving = ref(false) // Keep isSaving here for the savePlace action

  async function getBookmarks() {
    try {
      const response = await api.get('/library/places')
      const places = response.data
      bookmarksStore.setBookmarks(places)
      return places
    } catch (error) {
      toast.error('Failed to fetch bookmarks')
      return []
    }
  }

  // Places operations
  async function savePlace(
    place: UnifiedPlace,
    customName?: string,
    icon = 'map-pin',
    iconColor = '#F43F5E',
  ) {
    if (!place.externalIds || !place.externalIds.osm) {
      toast.error('Cannot save place without an OSM ID')
      return null
    }

    isSaving.value = true

    try {
      const params: CreateBookmarkParams = {
        externalIds: place.externalIds,
        name: customName || place.name,
        address: place.address?.formatted,
        icon,
        iconColor,
      }

      const response = await api.post('/library/places', params)
      const bookmark = response.data

      bookmarksStore.addBookmark(bookmark)
      toast.success(`Saved ${place.name}`)

      return bookmark
    } catch (error) {
      toast.error('Failed to save place')
      return null
    } finally {
      isSaving.value = false
    }
  }

  async function updatePlace(id: string, updates: Partial<Bookmark>) {
    try {
      const response = await api.put(`/library/places/${id}`, updates)
      const updated = response.data

      // Update store
      bookmarksStore.updateBookmark(id, updated)
      toast.success('Place updated successfully')

      return updated
    } catch (error) {
      toast.error('Failed to update place')
      return null
    }
  }

  // TODO: Remove from any collections the place is in
  async function unsavePlace(id: string, placeName: string) {
    try {
      await api.delete(`/library/places/${id}`)

      bookmarksStore.removeBookmark(id)
      toast.success(`Unsaved ${placeName}`)

      return true
    } catch (error) {
      toast.error('Failed to unsave place')
      return false
    }
  }

  function isPlaceSaved(place: UnifiedPlace) {
    if (!place.id) return false

    return bookmarksStore.bookmarks.some(bookmark => bookmark.id === place.id)
  }

  return {
    isSaving,
    getBookmarks,
    savePlace,
    updatePlace,
    unsavePlace,
    isPlaceSaved,
  }
})
