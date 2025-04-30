import { createSharedComposable } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import type { UnifiedPlace } from '@/types/unified-place.types'
import type { CreateBookmarkParams, Bookmark } from '@/types/library.types'
import { ref } from 'vue'
import { api } from '@/lib/api'

// TODO: i18n error messages

export const useBookmarksService = createSharedComposable(() => {
  const bookmarksStore = useBookmarksStore()
  const { t } = useI18n()
  const isSaving = ref(false) // Keep isSaving here for the savePlace action

  async function getBookmarks() {
    try {
      const response = await api.get('/library/places')
      const places = response.data
      bookmarksStore.setBookmarks(places)
      return places
    } catch (error) {
      toast.error(t('services.bookmarks.fetchError'))
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
    if (!place.externalIds?.osm) {
      toast.error(t('services.bookmarks.saveErrorNoOsmId'))
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
      toast.success(t('services.bookmarks.saveSuccess', { name: place.name }))

      return bookmark
    } catch (error) {
      toast.error(t('services.bookmarks.saveError'))
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
      toast.success(t('services.bookmarks.updateSuccess'))

      return updated
    } catch (error) {
      toast.error(t('services.bookmarks.updateError'))
      return null
    }
  }

  // TODO: Remove from any collections the place is in
  async function unsavePlace(id: string, placeName: string) {
    try {
      await api.delete(`/library/places/${id}`)

      bookmarksStore.removeBookmark(id)
      toast.success(t('services.bookmarks.deleteSuccess', { name: placeName }))

      return true
    } catch (error) {
      toast.error(t('services.bookmarks.deleteError'))
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
