import { createSharedComposable } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import type { CreateCollectionParams, Collection } from '@/types/library.types'
import { api } from '@/lib/api'

// TODO: i18n error messages

export const useCollectionsService = createSharedComposable(() => {
  const collectionsStore = useCollectionsStore()
  const bookmarksStore = useBookmarksStore()
  const { t } = useI18n()

  function getCollectionDisplayName(collection: Collection | null): string {
    if (!collection) return ''
    if (collection.isDefault) {
      return collection.name || t('library.entities.collections.default')
    }
    return collection.name
  }

  async function fetchCollections() {
    try {
      const response = await api.get('/library/collections')
      const collections = response.data
      collectionsStore.setCollections(collections)
      return collections
    } catch (error) {
      toast.error(t('services.collections.fetchError'))
      return []
    }
  }

  async function fetchCollectionById(id: string): Promise<Collection | null> {
    try {
      const response = await api.get(`/library/collections/${id}`)
      const collection = response.data

      if (collection) {
        collectionsStore.updateCollection(id, collection)
      }

      return collection
    } catch (error) {
      toast.error(t('services.collections.fetchOneError'))
      return null
    }
  }

  async function fetchDefaultCollection(): Promise<Collection | null> {
    try {
      const response = await api.get('/library/collections/default')
      const collection = response.data

      // Store the collection and its places in the normalized store
      if (collection) {
        collectionsStore.updateCollection(collection.id, collection)
      }

      return collection
    } catch (error) {
      toast.error(t('services.collections.fetchDefaultError'))
      return null
    }
  }

  async function createCollection(params: CreateCollectionParams) {
    try {
      const response = await api.post('/library/collections', params)
      const collection = response.data

      collectionsStore.addCollection(collection)
      toast.success(t('services.collections.createSuccess'))

      return collection
    } catch (error) {
      toast.error(t('services.collections.createError'))
      return null
    }
  }

  async function updateCollection(id: string, updates: Partial<Collection>) {
    try {
      const response = await api.put(`/library/collections/${id}`, updates)
      const updated = response.data

      collectionsStore.updateCollection(id, updated)
      toast.success(t('services.collections.updateSuccess'))

      return updated
    } catch (error) {
      toast.error(t('services.collections.updateError'))
      return null
    }
  }

  async function deleteCollection(id: string) {
    try {
      await api.delete(`/library/collections/${id}`)

      collectionsStore.removeCollection(id)
      toast.success(t('services.collections.deleteSuccess'))

      return true
    } catch (error) {
      toast.error(t('services.collections.deleteError'))
      return false
    }
  }

  async function saveToCollection(placeId: string, collectionId: string) {
    try {
      const response = await api.post(
        `/library/collections/${collectionId}/places/${placeId}`,
      )

      const collection = await fetchCollectionById(collectionId)
      if (collection) {
        toast.success(
          t('services.collections.addPlaceSuccess', {
            collectionName: getCollectionDisplayName(collection),
          }),
        )
      }

      return response.data
    } catch (error) {
      toast.error(t('services.collections.addPlaceError'))
      return false
    }
  }

  async function removeFromCollection(placeId: string, collectionId: string) {
    try {
      const response = await api.delete(
        `/library/collections/${collectionId}/places/${placeId}`,
      )

      const collectionsForPlace = await api.get(
        `/library/places/${placeId}/collections`,
      )
      const collections = collectionsForPlace.data

      if (collections.length === 0) {
        bookmarksStore.removeBookmark(placeId)
      }

      fetchCollectionById(collectionId)

      toast.success(t('services.collections.removePlaceSuccess'))
      return response.data
    } catch (error) {
      toast.error(t('services.collections.removePlaceError'))
      return false
    }
  }

  async function fetchBookmarksInCollection(collectionId: string) {
    try {
      const response = await api.get(
        `/library/collections/${collectionId}/places`,
      )
      return response.data
    } catch (error) {
      toast.error(t('services.collections.fetchPlacesError'))
      return []
    }
  }

  async function updateBookmarkInCollection(
    placeId: string,
    collectionId: string,
    updates: any,
  ) {
    try {
      const response = await api.put(
        `/library/collections/${collectionId}/places/${placeId}`,
        updates,
      )
      const updated = response.data

      const currentBookmark = bookmarksStore.bookmarks.find(
        bookmark => bookmark.id === placeId,
      )
      if (currentBookmark) {
        const updatedBookmark = {
          ...currentBookmark,
          ...updates,
        }
        bookmarksStore.updateBookmark(placeId, updatedBookmark)
      }

      fetchCollectionById(collectionId)

      toast.success(t('services.collections.updatePlaceSuccess'))

      return updated
    } catch (error) {
      toast.error(t('services.collections.updatePlaceError'))
      return null
    }
  }

  return {
    fetchCollections,
    fetchCollectionById,
    fetchDefaultCollection,
    createCollection,
    updateCollection,
    deleteCollection,
    saveToCollection,
    removeFromCollection,
    fetchBookmarksInCollection,
    updateBookmarkInCollection,
  }
})
