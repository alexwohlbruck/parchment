import { createSharedComposable } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import type { CreateCollectionParams, Collection } from '@/types/library.types'
import { api } from '@/lib/api'
import { getSeed } from '@/lib/key-storage'
import {
  encryptCollectionMetadata,
  decryptCollectionMetadata,
  type CollectionMetadata,
} from '@/lib/library-crypto'
import { useAuthStore } from '@/stores/auth.store'

// TODO: i18n error messages

/**
 * Decrypt a single collection's metadata envelope and merge the plaintext
 * fields (name, description, icon, iconColor) onto the collection object
 * in-place. Returns the collection either way so the caller can flow it
 * into the store whether or not decryption succeeded — undecryptable
 * collections still exist on the server; they just have no display
 * metadata until re-saved.
 */
async function hydrateDecryptedMetadata<T extends Collection & { bookmarks?: unknown }>(
  collection: T,
  userId: string | undefined,
): Promise<T> {
  if (!collection.metadataEncrypted) return collection
  if (!userId) return collection
  const seed = await getSeed()
  if (!seed) return collection
  try {
    const metadata = decryptCollectionMetadata({
      envelope: collection.metadataEncrypted,
      seed,
      userId,
      collectionId: collection.id,
    })
    if (metadata.name !== undefined) collection.name = metadata.name
    if (metadata.description !== undefined)
      collection.description = metadata.description
    if (metadata.icon !== undefined) collection.icon = metadata.icon
    if (metadata.iconColor !== undefined)
      collection.iconColor = metadata.iconColor
  } catch {
    // Undecryptable (wrong seed, tampered envelope, or the user doesn't
    // have a local seed yet). Leave the cleartext fields undefined; UI
    // renders a placeholder.
  }
  return collection
}

export const useCollectionsService = createSharedComposable(() => {
  const collectionsStore = useCollectionsStore()
  const authStore = useAuthStore()
  const { t } = useI18n()

  function getCollectionDisplayName(collection: Collection | null): string {
    if (!collection) return ''
    if (collection.isDefault) {
      return collection.name || t('library.entities.collections.default')
    }
    return collection.name ?? ''
  }

  /**
   * Build + encrypt a CollectionMetadata envelope for this user. Throws if
   * no seed is loaded — callers need to prompt the user through setup or
   * passkey unlock before reaching a create/update flow.
   */
  async function buildMetadataEnvelope(
    collectionId: string,
    metadata: CollectionMetadata,
  ): Promise<string> {
    const seed = await getSeed()
    if (!seed) throw new Error('No identity seed — cannot encrypt collection metadata')
    const userId = authStore.me?.id
    if (!userId) throw new Error('Not signed in')
    return encryptCollectionMetadata({
      metadata,
      seed,
      userId,
      collectionId,
    })
  }

  async function fetchCollections() {
    try {
      const response = await api.get('/library/collections')
      const collections = (response.data ?? []) as Collection[]
      const userId = authStore.me?.id
      const hydrated = await Promise.all(
        collections.map((c) => hydrateDecryptedMetadata(c, userId)),
      )
      collectionsStore.setCollections(hydrated)
      return hydrated
    } catch (error) {
      toast.error(t('services.collections.fetchError'))
      return []
    }
  }

  async function fetchCollectionById(id: string): Promise<Collection | null> {
    try {
      const response = await api.get(`/library/collections/${id}`)
      const collection = response.data as Collection
      const hydrated = await hydrateDecryptedMetadata(
        collection,
        authStore.me?.id,
      )
      collectionsStore.updateCollection(hydrated)
      return hydrated
    } catch (error) {
      toast.error(t('services.collections.fetchOneError'))
      return null
    }
  }

  async function fetchDefaultCollection(): Promise<Collection | null> {
    try {
      const response = await api.get('/library/collections/default')
      const collection = response.data as Collection | null

      if (collection) {
        const hydrated = await hydrateDecryptedMetadata(
          collection,
          authStore.me?.id,
        )
        collectionsStore.updateCollection(hydrated)
        return hydrated
      }

      return collection
    } catch (error) {
      toast.error(t('services.collections.fetchDefaultError'))
      return null
    }
  }

  async function createCollection(params: CreateCollectionParams) {
    try {
      // Generate the id client-side so we can derive the per-collection
      // key BEFORE the server knows the id. Server accepts opaque text ids
      // for rows (matches the existing `generateId` pattern elsewhere).
      // NOTE: actually the server generates the id today; to stay compatible,
      // encrypt with a placeholder OR do a two-step: server creates
      // row, we immediately PUT metadata. Two-step is simpler.
      const response = await api.post('/library/collections', {
        isPublic: params.isPublic ?? false,
        // Placeholder envelope so the NOT-NULL-ish shape is satisfied.
        // We rewrite with real metadata immediately below.
        metadataEncrypted: '',
      })
      const created = response.data as Collection

      const envelope = await buildMetadataEnvelope(created.id, {
        name: params.name,
        description: params.description,
        icon: params.icon,
        iconColor: params.iconColor,
        isPublic: params.isPublic,
      })
      const updated = await api.put(`/library/collections/${created.id}`, {
        metadataEncrypted: envelope,
      })
      const hydrated = await hydrateDecryptedMetadata(
        updated.data as Collection,
        authStore.me?.id,
      )

      collectionsStore.updateCollection(hydrated)
      toast.success(t('services.collections.createSuccess'))
      return hydrated
    } catch (error) {
      toast.error(t('services.collections.createError'))
      return null
    }
  }

  async function updateCollection(id: string, updates: Partial<Collection>) {
    try {
      // If the caller changed any display field, rebuild + encrypt the
      // envelope using the merged current+new metadata.
      const current = collectionsStore.getCollectionById(id)
      const metadataChanged =
        updates.name !== undefined ||
        updates.description !== undefined ||
        updates.icon !== undefined ||
        updates.iconColor !== undefined

      const body: Record<string, unknown> = {}
      if (updates.isPublic !== undefined) body.isPublic = updates.isPublic

      if (metadataChanged) {
        const merged: CollectionMetadata = {
          name: updates.name ?? current?.name,
          description: updates.description ?? current?.description,
          icon: updates.icon ?? current?.icon,
          iconColor: updates.iconColor ?? current?.iconColor,
          isPublic: updates.isPublic ?? current?.isPublic,
        }
        body.metadataEncrypted = await buildMetadataEnvelope(id, merged)
      }

      const response = await api.put(`/library/collections/${id}`, body)
      const updatedServer = response.data as Collection
      const hydrated = await hydrateDecryptedMetadata(
        updatedServer,
        authStore.me?.id,
      )

      collectionsStore.updateCollection(hydrated)
      toast.success(t('services.collections.updateSuccess'))
      return hydrated
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
