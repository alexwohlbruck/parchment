import { createSharedComposable } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import type { CreateCollectionParams, Collection } from '@/types/library.types'
import { api } from '@/lib/api'

// TODO: i18n error messages

export const useCollectionsService = createSharedComposable(() => {
  const collectionsStore = useCollectionsStore()
  const bookmarksStore = useBookmarksStore()

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
      return response.data
    } catch (error) {
      toast.error('Collection not found')
      return null
    }
  }

  async function fetchDefaultCollection(): Promise<Collection | null> {
    try {
      const response = await api.get('/library/collections/default')
      const collection = response.data

      // If this is the default collection, we'll use the i18n name
      if (collection && collection.isDefault) {
        // We'll keep the original name in the API response, but the UI will display the translated name
        // The actual translation will happen in the UI components
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

      console.log(response.data)
      // TODO: Add toast message using collection name (requires fetching collection first?)
      // toast.success(`Added to ${collection.name}`)
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

      toast.success('Place removed from collection')
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
