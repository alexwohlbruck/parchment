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

  // Helper function to get display name
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
      toast.error('Failed to fetch collections')
      return []
    }
  }

  async function fetchCollectionById(id: string): Promise<Collection | null> {
    try {
      const response = await api.get(`/library/collections/${id}`)
      const collection = response.data

      // Store the collection and its places in the normalized store
      if (collection) {
        collectionsStore.updateCollection(id, collection)
      }

      return collection
    } catch (error) {
      toast.error('Collection not found')
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
      toast.error('Failed to fetch default collection')
      return null
    }
  }

  async function createCollection(params: CreateCollectionParams) {
    try {
      const response = await api.post('/library/collections', params)
      const collection = response.data

      collectionsStore.addCollection(collection)
      toast.success('Collection created successfully')

      return collection
    } catch (error) {
      toast.error('Failed to create collection')
      return null
    }
  }

  async function updateCollection(id: string, updates: Partial<Collection>) {
    try {
      const response = await api.put(`/library/collections/${id}`, updates)
      const updated = response.data

      collectionsStore.updateCollection(id, updated)
      toast.success('Collection updated successfully')

      return updated
    } catch (error) {
      toast.error('Failed to update collection')
      return null
    }
  }

  async function deleteCollection(id: string) {
    try {
      await api.delete(`/library/collections/${id}`)

      collectionsStore.removeCollection(id)
      toast.success('Collection deleted successfully')

      return true
    } catch (error) {
      toast.error('Failed to delete collection')
      return false
    }
  }

  async function addPlaceToCollection(placeId: string, collectionId: string) {
    try {
      const response = await api.post(
        `/library/collections/${collectionId}/places/${placeId}`,
      )

      const collection = await fetchCollectionById(collectionId)
      if (collection) {
        toast.success(
          t('library.actions.addedToCollection', {
            collection: getCollectionDisplayName(collection),
          }),
        )
      }

      return response.data
    } catch (error) {
      toast.error('Failed to add place to collection')
      return false
    }
  }

  async function removePlaceFromCollection(
    placeId: string,
    collectionId: string,
  ) {
    try {
      const response = await api.delete(
        `/library/collections/${collectionId}/places/${placeId}`,
      )

      // Only remove the bookmark from the store if it's not in any other collections
      // First check if this place is in any other collections
      const collectionsForPlace = await api.get(
        `/library/places/${placeId}/collections`,
      )
      const collections = collectionsForPlace.data

      // If this was the last collection containing the place, then remove the bookmark
      if (collections.length === 0) {
        bookmarksStore.removeBookmark(placeId)
      }

      // Refresh the collection to ensure consistent state
      fetchCollectionById(collectionId)

      toast.success(t('library.actions.removedFromCollectionSuccess'))
      return response.data
    } catch (error) {
      toast.error('Failed to remove place from collection')
      return false
    }
  }

  async function fetchPlacesInCollection(collectionId: string) {
    try {
      const response = await api.get(
        `/library/collections/${collectionId}/places`,
      )
      return response.data
    } catch (error) {
      toast.error('Failed to fetch places in collection')
      return []
    }
  }

  async function updatePlaceInCollection(
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

      // Update the bookmark in the bookmarks store
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

      // Refresh the collection to ensure consistent state
      fetchCollectionById(collectionId)

      toast.success('Place updated successfully')

      return updated
    } catch (error) {
      toast.error('Failed to update place')
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
    addPlaceToCollection,
    removePlaceFromCollection,
    fetchPlacesInCollection,
    updatePlaceInCollection,
  }
})
