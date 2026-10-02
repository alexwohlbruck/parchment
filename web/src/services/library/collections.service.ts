import { createSharedComposable } from '@vueuse/core'
import { toast } from '@/lib/toast'
import { useI18n } from 'vue-i18n'
import { useCollectionsStore } from '@/stores/library/collections.store'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { useFriendsStore } from '@/stores/friends.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useEncryptedPointsStore } from '@/stores/library/encrypted-points.store'
import type {
  Bookmark,
  CreateCollectionParams,
  Collection,
  DecryptedPoint,
} from '@/types/library.types'
import { api } from '@/lib/api'
import { getSeed } from '@/lib/identity/key-storage'
import {
  collectionMetadataOf,
  encryptCollectionMetadata,
  decryptCollectionMetadata,
  decryptCollectionPoint,
  type CollectionMetadata,
} from '@/lib/identity/library-crypto'
import {
  decryptFromFriend,
  encryptForFriend,
  importPublicKey,
} from '@/lib/identity/federation-crypto'
import {
  listSharesForResource,
  updateShareEnvelope,
} from '@/services/sharing.service'
import {
  downgradeCollectionToServerKey,
  upgradeCollectionToE2ee,
} from '@/lib/identity/collection-scheme-switch'
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
    iconPack?: 'lucide' | 'maki'
    iconColor?: string
  },
): void {
  if (metadata.name !== undefined) collection.name = metadata.name
  if (metadata.description !== undefined)
    collection.description = metadata.description
  if (metadata.icon !== undefined) collection.icon = metadata.icon
  if (metadata.iconPack !== undefined) collection.iconPack = metadata.iconPack
  if (metadata.iconColor !== undefined)
    collection.iconColor = metadata.iconColor
}

/**
 * A user-e2ee collection this device can't open is locked. A server-key row
 * whose legacy envelope won't open just has no name; its places are readable.
 */
function markUnreadable(collection: Collection) {
  collection.locked = collection.scheme === 'user-e2ee'
}

/** Store a decrypted legacy envelope's metadata in the clear, dropping it. */
async function moveMetadataToCleartext(collection: Collection) {
  try {
    await api.put(`/library/collections/${collection.id}`, {
      ...collectionMetadataOf(collection),
      name: collection.name ?? '',
    })
    collection.metadataEncrypted = null
  } catch (err) {
    console.warn('[collections] failed to move metadata to cleartext', collection.id, err)
  }
}

/**
 * Fill in a collection's display metadata. Mutates and returns `collection`.
 *
 * Server-key rows arrive with metadata in the clear. Everything else is
 * decrypted: the owner's rows with their seed, shared rows from the ECIES
 * share envelope the owner packaged for this recipient.
 */
async function hydrateDecryptedMetadata<
  T extends Collection & { bookmarks?: unknown },
>(
  collection: T,
  userId: string | undefined,
  ctx?: { friendsStore?: ReturnType<typeof useFriendsStore>; identityStore?: ReturnType<typeof useIdentityStore> },
): Promise<T> {
  collection.locked = false
  if (!collection.metadataEncrypted) return collection

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
      markUnreadable(collection)
      return collection
    }
    if (!myEncPriv) {
      console.warn('[collections] shared metadata: no encryption private key')
      markUnreadable(collection)
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
        markUnreadable(collection)
      }
    } catch (err) {
      console.warn(
        '[collections] failed to decrypt shared envelope for',
        collection.id,
        err,
      )
      markUnreadable(collection)
    }
    return collection
  }

  const seed = userId ? await getSeed() : null
  try {
    if (!seed || !userId) throw new Error('No identity seed on this device')
    stampMetadata(
      collection,
      decryptCollectionMetadata({
        envelope: collection.metadataEncrypted,
        seed,
        userId,
        collectionId: collection.id,
        keyVersion: collection.metadataKeyVersion,
      }),
    )
  } catch {
    markUnreadable(collection)
    return collection
  }
  if (collection.scheme === 'server-key' && collection.role === 'owner') {
    void moveMetadataToCleartext(collection)
  }
  return collection
}

/** The server creates a starter collection it can't name in the user's language. */
function isUnnamedStarter(collection: Collection): boolean {
  return (
    collection.role === 'owner' &&
    collection.scheme === 'server-key' &&
    !collection.metadataEncrypted &&
    collection.name == null
  )
}

export const useCollectionsService = createSharedComposable(() => {
  const collectionsStore = useCollectionsStore()
  const authStore = useAuthStore()
  const friendsStore = useFriendsStore()
  const identityStore = useIdentityStore()
  const { t } = useI18n()

  function getCollectionDisplayName(collection: Collection | null): string {
    if (!collection) return ''
    if (collection.locked) return t('library.entities.collections.locked')
    return collection.name || t('library.entities.collections.untitled')
  }

  /**
   * Seal metadata for a user-e2ee collection. Throws without a seed — the
   * collection is locked on this device, so there is nothing to edit.
   */
  async function buildMetadataEnvelope(
    collection: Collection,
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
      collectionId: collection.id,
      keyVersion: collection.metadataKeyVersion,
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

      await Promise.all(hydrated.filter(isUnnamedStarter).map(nameStarterCollection))

      collectionsStore.setCollections(hydrated)
      return hydrated
    } catch (error) {
      toast.error(t('services.collections.fetchError'))
      return []
    }
  }

  async function nameStarterCollection(collection: Collection) {
    const metadata: CollectionMetadata = {
      name: t('library.entities.collections.starterName'),
      icon: 'Bookmark',
      iconColor: 'cobalt',
    }
    try {
      await api.put(`/library/collections/${collection.id}`, metadata)
      stampMetadata(collection, metadata)
    } catch (err) {
      console.warn('[collections] failed to name starter collection', collection.id, err)
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

  async function createCollection(params: CreateCollectionParams) {
    try {
      const metadata = collectionMetadataOf(params)
      const isPublic = params.isPublic ?? false
      let created: Collection

      if (params.scheme === 'user-e2ee') {
        const { data } = await api.post<Collection>('/library/collections', {
          scheme: 'user-e2ee',
          isPublic,
        })
        const { data: sealed } = await api.put<Collection>(
          `/library/collections/${data.id}`,
          { metadataEncrypted: await buildMetadataEnvelope(data, metadata) },
        )
        created = await hydrateDecryptedMetadata(
          { ...sealed, role: 'owner' },
          authStore.me?.id,
        )
      } else {
        const { data } = await api.post<Collection>('/library/collections', {
          ...metadata,
          isPublic,
        })
        created = { ...data, role: 'owner' }
      }

      collectionsStore.updateCollection(created)
      toast.success(t('services.collections.createSuccess'))
      return created
    } catch (error) {
      toast.error(t('services.collections.createError'))
      return null
    }
  }

  /**
   * Reissue the ECIES share envelope for every recipient of a user-e2ee
   * collection so their clients see the new metadata on next decrypt. The
   * realtime event carries only the owner-sealed envelope, which recipients
   * can't open.
   */
  async function reissueShareEnvelopes(
    collectionId: string,
    meta: {
      name?: string
      description?: string
      icon?: string
      iconPack?: 'lucide' | 'maki'
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
        iconPack: meta.iconPack,
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
      const current = collectionsStore.getCollectionById(id)
      if (!current) throw new Error(`Collection ${id} is not loaded`)
      const e2ee = current.scheme === 'user-e2ee'
      const metadataChanged =
        updates.name !== undefined ||
        updates.description !== undefined ||
        updates.icon !== undefined ||
        updates.iconPack !== undefined ||
        updates.iconColor !== undefined

      const body: Record<string, unknown> = {}
      if (updates.isPublic !== undefined) body.isPublic = updates.isPublic

      if (metadataChanged) {
        const merged = collectionMetadataOf({ ...current, ...updates })
        if (e2ee) body.metadataEncrypted = await buildMetadataEnvelope(current, merged)
        else Object.assign(body, merged)
      }

      const response = await api.put(`/library/collections/${id}`, body)
      const hydrated = await hydrateDecryptedMetadata(
        { ...(response.data as Collection), role: current.role },
        authStore.me?.id,
      )

      collectionsStore.updateCollection(hydrated)

      // Server-key recipients read the new metadata straight from the row.
      if (metadataChanged && e2ee) {
        // Fire-and-forget: failures here shouldn't block the local
        // update. Worst case a recipient sees the old name until their
        // next re-share.
        void reissueShareEnvelopes(id, {
          ...collectionMetadataOf(hydrated),
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

  /**
   * Re-package a collection under the other scheme: places and metadata move
   * together, and every remaining share is rewrapped. Throws on failure.
   */
  async function changeScheme(
    collection: Collection,
    target: Collection['scheme'],
  ): Promise<Collection> {
    const ownerUserId = authStore.me?.id
    const ownerEncryptionPrivateKey = identityStore.encryptionPrivateKey
    if (!ownerUserId || !ownerEncryptionPrivateKey) {
      throw new Error('No identity on this device')
    }

    if (friendsStore.friends.length === 0) await friendsStore.loadFriends()
    const shares = await listSharesForResource('collection', collection.id)
    const remainingShares = shares.flatMap((share) => {
      if (share.status === 'revoked') return []
      const friend = friendsStore.friends.find(
        (f) => f.friendHandle === share.recipientHandle,
      )
      if (!friend?.friendEncryptionKey) return []
      return [
        {
          id: share.id,
          recipientHandle: share.recipientHandle,
          recipientEncryptionKey: friend.friendEncryptionKey,
        },
      ]
    })

    const base = { collection, ownerUserId, remainingShares, ownerEncryptionPrivateKey }
    const switched =
      target === 'user-e2ee'
        ? await upgradeCollectionToE2ee({
            ...base,
            currentBookmarks:
              (await api.get(`/library/collections/${collection.id}`)).data
                .bookmarks ?? [],
          })
        : await downgradeCollectionToServerKey({
            ...base,
            currentPoints:
              (await api.get(`/library/collections/${collection.id}/encrypted-points`))
                .data.points ?? [],
          })

    const hydrated = await hydrateDecryptedMetadata(
      { ...switched, role: collection.role },
      ownerUserId,
    )
    collectionsStore.updateCollection(hydrated)
    useEncryptedPointsStore().clearCollection(collection.id)
    return hydrated
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
  // Encrypted Points
  // ============================================================================

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

  /**
   * Fetch and decrypt a `user-e2ee` collection's points into the encrypted
   * points store, so the saved-places layer can draw them.
   *
   * Called lazily when a collection's layer is switched on rather than at
   * boot: decryption is per-point work the user hasn't asked for until they
   * want to see the collection, and the plaintext is deliberately session-only.
   *
   * A point that fails to decrypt is skipped, not thrown — one bad envelope
   * (wrong seed, stale key version, tampering) must not blank the whole map.
   */
  async function fetchAndDecryptPoints(
    collection: Collection,
  ): Promise<DecryptedPoint[]> {
    const pointsStore = useEncryptedPointsStore()
    const { id } = collection

    if (pointsStore.isLoaded(id)) return pointsStore.getPoints(id)
    const pending = inflightPoints.get(id)
    if (pending) return pending

    const load = decryptPoints(collection).finally(() => inflightPoints.delete(id))
    inflightPoints.set(id, load)
    return load
  }

  /** Concurrent callers share one fetch, and all get the decrypted result. */
  const inflightPoints = new Map<string, Promise<DecryptedPoint[]>>()

  async function decryptPoints(collection: Collection): Promise<DecryptedPoint[]> {
    const pointsStore = useEncryptedPointsStore()
    const { id } = collection
    pointsStore.beginLoad(id)

    try {
      const seed = await getSeed()
      const ownerUserId = collection.userId || authStore.me?.id
      if (!seed || !ownerUserId) {
        pointsStore.setPoints(id, [])
        return []
      }

      const raw = await getEncryptedPoints(id)
      const decrypted: DecryptedPoint[] = []
      for (const point of raw) {
        try {
          decrypted.push({
            ...decryptCollectionPoint({
              point,
              seed,
              ownerUserId,
              collectionId: id,
              keyVersion: collection.metadataKeyVersion ?? 1,
            }),
            createdAt: point.createdAt,
            updatedAt: point.updatedAt,
          })
        } catch {
          console.warn(
            '[collections] could not decrypt point',
            point.id,
            'in collection',
            id,
          )
        }
      }

      pointsStore.setPoints(id, decrypted)
      return decrypted
    } catch (e) {
      console.warn('[collections] failed to load encrypted points for', id, e)
      pointsStore.endLoad(id)
      return []
    }
  }

  /** A collection someone shared by link, or null once the link is gone. */
  async function fetchPublicCollection(
    token: string,
  ): Promise<{ collection: Collection; places: Bookmark[] } | null> {
    try {
      const { data } = await api.get(`/public/collections/${token}`)
      return { collection: data.collection, places: data.bookmarks }
    } catch {
      return null
    }
  }

  /** Decrypt every private collection the caller owns and can open. */
  async function loadPrivatePoints() {
    await Promise.all(
      collectionsStore.collections
        .filter(c => c.scheme === 'user-e2ee' && c.role === 'owner' && !c.locked)
        .map(fetchAndDecryptPoints),
    )
  }

  async function createEncryptedPoint(
    collectionId: string,
    point: { id: string; encryptedData: string },
  ) {
    await api.post(`/library/collections/${collectionId}/encrypted-points`, {
      ...point,
      nonce: '',
    })
  }

  async function deleteEncryptedPoint(collectionId: string, pointId: string) {
    await api.delete(
      `/library/collections/${collectionId}/encrypted-points/${pointId}`,
    )
  }

  return {
    fetchCollections,
    fetchCollectionById,
    createCollection,
    updateCollection,
    changeScheme,
    deleteCollection,
    getBookmarksInCollection,
    getCollectionDisplayName,
    getEncryptedPoints,
    fetchAndDecryptPoints,
    loadPrivatePoints,
    fetchPublicCollection,
    createEncryptedPoint,
    deleteEncryptedPoint,
  }
})
