import { createSharedComposable } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useFriendsStore } from '@/stores/friends.store'
import { useIdentityStore } from '@/stores/identity.store'
import type { CreateCollectionParams, Collection } from '@/types/library.types'
import { api } from '@/lib/api'
import { getSeed } from '@/lib/key-storage'
import {
  encryptCollectionMetadata,
  decryptCollectionMetadata,
  type CollectionMetadata,
} from '@/lib/library-crypto'
import {
  decryptFromFriend,
  encryptForFriend,
  importPublicKey,
} from '@/lib/federation-crypto'
import {
  listSharesForResource,
  updateShareEnvelope,
} from '@/services/sharing.service'
import { useAuthStore } from '@/stores/auth.store'

// TODO: i18n error messages

/**
 * Shape of the ECIES payload the owner ships in `incoming_shares.encryptedData`.
 * Stays in sync with what ShareDialog.addShare serializes.
 */
interface SharedPayload {
  collectionId: string
  scheme: string
  metadata?: {
    name?: string
    description?: string
    icon?: string
    iconColor?: string
  }
}

function stampMetadata(
  collection: Collection,
  metadata: {
    name?: string
    description?: string
    icon?: string
    iconColor?: string
  },
): void {
  if (metadata.name !== undefined) collection.name = metadata.name
  if (metadata.description !== undefined)
    collection.description = metadata.description
  if (metadata.icon !== undefined) collection.icon = metadata.icon
  if (metadata.iconColor !== undefined)
    collection.iconColor = metadata.iconColor
}

/**
 * Decrypt a single collection's metadata envelope and merge the plaintext
 * fields (name, description, icon, iconColor) onto the collection object
 * in-place. Returns the collection either way so the caller can flow it
 * into the store whether or not decryption succeeded — undecryptable
 * collections still exist on the server; they just have no display
 * metadata until re-saved.
 *
 * Two paths:
 *   - Owner row → decrypt `metadataEncrypted` using the caller's seed.
 *   - Shared row → decrypt the ECIES `shareEnvelope` using the caller's
 *     encryption key + the sender's long-term public key (from the
 *     friends store), extract the inline `metadata`, stamp it onto the
 *     collection. The K_m-encrypted `metadataEncrypted` envelope stays
 *     on the row but can't be decrypted by the recipient — that's fine,
 *     we ignore it in favor of the share payload.
 */
async function hydrateDecryptedMetadata<
  T extends Collection & { bookmarks?: unknown },
>(
  collection: T,
  userId: string | undefined,
  ctx?: { friendsStore?: ReturnType<typeof useFriendsStore>; identityStore?: ReturnType<typeof useIdentityStore> },
): Promise<T> {
  // Shared collection: prefer the ECIES share envelope — it carries the
  // metadata that the owner deliberately packaged for this recipient.
  if (
    collection.role &&
    collection.role !== 'owner' &&
    collection.shareEnvelope &&
    collection.senderHandle &&
    ctx?.friendsStore &&
    ctx?.identityStore
  ) {
    const friend = ctx.friendsStore.friends.find(
      (f) => f.friendHandle === collection.senderHandle,
    )
    const myEncPriv = ctx.identityStore.encryptionPrivateKey
    if (!friend?.friendEncryptionKey) {
      console.warn(
        '[collections] shared metadata: friend record missing for sender',
        collection.senderHandle,
        'friend count:',
        ctx.friendsStore.friends.length,
      )
      return collection
    }
    if (!myEncPriv) {
      console.warn('[collections] shared metadata: no encryption private key')
      return collection
    }
    try {
      const senderPub = importPublicKey(friend.friendEncryptionKey)
      const plaintext = decryptFromFriend(
        collection.shareEnvelope.encryptedData,
        collection.shareEnvelope.nonce,
        myEncPriv,
        senderPub,
        'parchment-share-collection-v1',
      )
      const parsed = JSON.parse(plaintext) as SharedPayload
      if (parsed.metadata) {
        stampMetadata(collection, parsed.metadata)
      } else {
        console.warn(
          '[collections] shared envelope decrypted but has no metadata (old share format?)',
          collection.id,
        )
      }
    } catch (err) {
      console.warn(
        '[collections] failed to decrypt shared envelope for',
        collection.id,
        err,
      )
    }
    return collection
  }

  // Owner row: decrypt the K_m-bound envelope as usual.
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
    stampMetadata(collection, metadata)
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
  const friendsStore = useFriendsStore()
  const identityStore = useIdentityStore()
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
      // Fetch owned + shared in parallel. Both are merged into the same
      // list the UI renders, but the `role` field on each item tells the
      // component whether to show write affordances. Owned rows have no
      // role set — we stamp 'owner' for consistency downstream.
      const [ownedResp, sharedResp] = await Promise.all([
        api.get('/library/collections'),
        api.get('/library/collections/shared-with-me').catch(() => ({
          // Graceful degradation: older servers won't expose this endpoint
          // yet. Treat as "no shared collections" rather than failing the
          // whole library fetch.
          data: [] as Collection[],
        })),
      ])
      const owned = ((ownedResp.data ?? []) as Collection[]).map((c) => ({
        ...c,
        role: 'owner' as const,
      }))
      const shared = (sharedResp.data ?? []) as Collection[]

      // Shared rows decrypt their display metadata from an ECIES envelope
      // keyed by the sender's long-term X25519 pubkey — which lives on the
      // friend record. The library view doesn't currently preload friends
      // (it's done on-demand elsewhere), so the first library fetch after
      // app start can race ahead of the friends store. Force a load now so
      // decryption has what it needs.
      if (shared.length > 0 && friendsStore.friends.length === 0) {
        await friendsStore.loadFriends()
      }

      const userId = authStore.me?.id
      const hydrated = await Promise.all(
        [...owned, ...shared].map(async (c) => {
          // Owner rows decrypt the K_m envelope; shared rows fall into
          // the ECIES share-envelope branch inside hydrateDecryptedMetadata.
          return hydrateDecryptedMetadata(
            c,
            c.role === 'owner' ? userId : c.userId,
            { friendsStore, identityStore },
          )
        }),
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

      // If this is a shared collection, we need the friends store
      // populated to decrypt the display metadata from the ECIES share
      // envelope. Friends are loaded on-demand elsewhere so force a
      // preload when we haven't fetched them yet.
      if (
        collection.role &&
        collection.role !== 'owner' &&
        friendsStore.friends.length === 0
      ) {
        await friendsStore.loadFriends()
      }

      const hydrated = await hydrateDecryptedMetadata(
        collection,
        collection.role === 'owner' || !collection.role
          ? authStore.me?.id
          : collection.userId,
        { friendsStore, identityStore },
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

  /**
   * Reissue the ECIES share envelope for every recipient of a collection
   * so their clients see the new metadata (name/icon/description) on
   * next decrypt.
   *
   * The incoming realtime event is K_m-encrypted (readable only by the
   * owner), so recipients' UIs can't re-render the new name just from
   * the event. Recomputing + pushing fresh envelopes is the way to
   * propagate metadata changes without a full share-dialog round-trip.
   */
  async function reissueShareEnvelopes(
    collectionId: string,
    meta: {
      name?: string
      description?: string
      icon?: string
      iconColor?: string
      scheme: Collection['scheme']
    },
  ): Promise<void> {
    const myEncPriv = identityStore.encryptionPrivateKey
    if (!myEncPriv) return

    let shares: Awaited<ReturnType<typeof listSharesForResource>>
    try {
      shares = await listSharesForResource('collection', collectionId)
    } catch {
      return
    }
    if (shares.length === 0) return

    const payload = JSON.stringify({
      collectionId,
      scheme: meta.scheme,
      metadata: {
        name: meta.name,
        description: meta.description,
        icon: meta.icon,
        iconColor: meta.iconColor,
      },
    })

    // Parallelize. One failure shouldn't stop the rest — a single
    // unreachable friend shouldn't block other recipients from seeing
    // the new name.
    await Promise.all(
      shares
        .filter((s) => s.status !== 'revoked')
        .map(async (share) => {
          const friend = friendsStore.friends.find(
            (f) => f.friendHandle === share.recipientHandle,
          )
          if (!friend?.friendEncryptionKey) return
          try {
            const encrypted = encryptForFriend(
              payload,
              myEncPriv,
              importPublicKey(friend.friendEncryptionKey),
              'parchment-share-collection-v1',
            )
            await updateShareEnvelope({
              recipientHandle: share.recipientHandle,
              resourceType: 'collection',
              resourceId: collectionId,
              encryptedData: encrypted.ciphertext,
              nonce: encrypted.nonce,
            })
          } catch (err) {
            console.warn(
              '[collections] failed to reissue envelope for',
              share.recipientHandle,
              err,
            )
          }
        }),
    )
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

      // If the owner changed metadata on a shared collection, reissue
      // every friend's share envelope with the new plaintext baked in.
      // Without this, recipients keep their old (stale) share envelope
      // and never see the rename — the server's realtime payload is
      // K_m-encrypted and can't be decrypted by them.
      if (metadataChanged) {
        // Fire-and-forget: failures here shouldn't block the local
        // update. Worst case a recipient sees the old name until their
        // next re-share.
        void reissueShareEnvelopes(id, {
          name: hydrated.name,
          description: hydrated.description,
          icon: hydrated.icon,
          iconColor: hydrated.iconColor,
          scheme: hydrated.scheme,
        })
      }

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
