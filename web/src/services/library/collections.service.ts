import { createSharedComposable } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { useCollectionsStore } from '@/stores/library/collections.store'
import type { CreateCollectionParams, Collection } from '@/types/library.types'
import { api } from '@/lib/api'

export const useCollectionsService = createSharedComposable(() => {
  const collectionsStore = useCollectionsStore()

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
    let collection = collectionsStore.getCollectionById(id)

    if (!collection && collectionsStore.collections.length === 0) {
      await fetchCollections()
      collection = collectionsStore.getCollectionById(id)
    }

    if (!collection) {
      try {
        const response = await api.get(`/library/collections/${id}`)
        collection = response.data
      } catch (error) {
        toast.error('Collection not found')
        return null
      }
    }

    return collection || null
  }

  // Collection operations
  async function createCollection(params: CreateCollectionParams) {
    try {
      const response = await api.post('/library/collections', params)
      const collection = response.data

      // Update store
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
      const response = await api.patch(`/library/collections/${id}`, updates)
      const updated = response.data

      // Update store
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

      // Update store
      collectionsStore.removeCollection(id)
      toast.success('Collection deleted successfully')

      return true
    } catch (error) {
      toast.error('Failed to delete collection')
      return false
    }
  }

  // Collection-place relationships
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

  return {
    // Data fetching
    fetchCollections,
    fetchCollectionById,

    // Collection operations
    createCollection,
    updateCollection,
    deleteCollection,

    // Collection-place relationships
    addPlaceToCollection,
    removePlaceFromCollection,
    fetchPlacesInCollection,
  }
})
