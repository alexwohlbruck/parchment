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

      collectionsStore.updateCollection(collection)

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
        collectionsStore.updateCollection(collection)
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

      // Add the new collection using the upsert logic
      collectionsStore.updateCollection(collection)
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

      collectionsStore.updateCollection(updated)
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

  async function getBookmarksInCollection(collectionId: string) {
    try {
      const response = await api.get(
        `/library/collections/${collectionId}/bookmarks`,
      )
      return response.data
    } catch (error) {
      toast.error(t('services.collections.fetchBookmarksError'))
      return []
    }
  }

  // ============================================================================
  // Sensitive Collections & Encrypted Points
  // ============================================================================

  async function setSensitive(collectionId: string, isSensitive: boolean) {
    try {
      const response = await api.put(
        `/library/collections/${collectionId}/sensitive`,
        { isSensitive },
      )
      return response.data.success
    } catch (error) {
      toast.error('Failed to update collection sensitivity')
      return false
    }
  }

  async function getEncryptedPoints(collectionId: string) {
    try {
      const response = await api.get(
        `/library/collections/${collectionId}/encrypted-points`,
      )
      return response.data.points as Array<{
        id: string
        encryptedData: string
        nonce: string
        createdAt: string
        updatedAt: string
      }>
    } catch (error) {
      toast.error('Failed to fetch encrypted points')
      return []
    }
  }

  async function createEncryptedPoint(
    collectionId: string,
    encryptedData: string,
    nonce: string,
  ) {
    try {
      const response = await api.post(
        `/library/collections/${collectionId}/encrypted-points`,
        { encryptedData, nonce },
      )
      return response.data
    } catch (error) {
      toast.error('Failed to create encrypted point')
      return null
    }
  }

  async function updateEncryptedPoint(
    collectionId: string,
    pointId: string,
    encryptedData: string,
    nonce: string,
  ) {
    try {
      const response = await api.put(
        `/library/collections/${collectionId}/encrypted-points/${pointId}`,
        { encryptedData, nonce },
      )
      return response.data
    } catch (error) {
      toast.error('Failed to update encrypted point')
      return null
    }
  }

  async function deleteEncryptedPoint(collectionId: string, pointId: string) {
    try {
      await api.delete(
        `/library/collections/${collectionId}/encrypted-points/${pointId}`,
      )
      return true
    } catch (error) {
      toast.error('Failed to delete encrypted point')
      return false
    }
  }

  return {
    fetchCollections,
    fetchCollectionById,
    fetchDefaultCollection,
    createCollection,
    updateCollection,
    deleteCollection,
    getBookmarksInCollection,
    getCollectionDisplayName,
    // Sensitive collections
    setSensitive,
    getEncryptedPoints,
    createEncryptedPoint,
    updateEncryptedPoint,
    deleteEncryptedPoint,
  }
})
