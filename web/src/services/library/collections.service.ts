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
  type CollectionKeySource,
  type CollectionMetadata,
} from '@/lib/identity/library-crypto'
import {
  deriveCollectionKey,
  importPublicKey,
} from '@/lib/identity/federation-crypto'
import { openCollectionShare } from '@/lib/identity/collection-share'
import { useCollectionKeysStore } from '@/stores/library/collection-keys.store'
import { listSharesForResource } from '@/services/sharing.service'
import {
  downgradeCollectionToServerKey,
  upgradeCollectionToE2ee,
} from '@/lib/identity/collection-scheme-switch'
import { useAuthStore } from '@/stores/auth.store'

// TODO: i18n error messages

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

function isOwnCollection(collection: Collection): boolean {
  return collection.userId === useAuthStore().me?.id
}

/**
 * Open the envelope a collection's owner sealed for this user and keep the
 * key it carries. A new key version drops places decrypted under the old one.
 */
function openShareEnvelope(collection: Collection) {
  if (!collection.shareEnvelope || !collection.senderHandle) return
  const sender = useFriendsStore().friends.find(
    f => f.friendHandle === collection.senderHandle,
  )
  const recipientPrivateKey = useIdentityStore().encryptionPrivateKey
  if (!sender?.friendEncryptionKey || !recipientPrivateKey) return
  try {
    const share = openCollectionShare({
      envelope: collection.shareEnvelope,
      recipientPrivateKey,
      senderPublicKey: importPublicKey(sender.friendEncryptionKey),
    })
    if (!share.key) return
    const keysStore = useCollectionKeysStore()
    const version = share.keyVersion ?? 1
    if (keysStore.get(collection.id)?.version !== version) {
      useEncryptedPointsStore().clearCollection(collection.id)
    }
    keysStore.set(collection.id, { key: share.key, version })
  } catch (err) {
    console.warn('[collections] could not open share envelope for', collection.id, err)
  }
}

/** How this device reaches a collection's current key, or null when it can't. */
async function collectionKeySource(
  collection: Collection,
): Promise<CollectionKeySource | null> {
  if (isOwnCollection(collection)) {
    const seed = await getSeed()
    return seed ? { seed } : null
  }
  const shared = useCollectionKeysStore().get(collection.id)
  return shared && shared.version === (collection.metadataKeyVersion ?? 1)
    ? { key: shared.key }
    : null
}

/** The current key itself, for sealing it into a friend's share envelope. */
async function collectionKey(collection: Collection): Promise<Uint8Array | null> {
  const source = await collectionKeySource(collection)
  if (!source) return null
  return 'key' in source
    ? source.key
    : deriveCollectionKey(source.seed, collection.id, collection.metadataKeyVersion ?? 1)
}

/**
 * Fill in a collection's display metadata. Mutates and returns `collection`.
 * Server-key rows arrive with it in the clear; a private collection's is
 * sealed with the collection key, which owner and recipients both reach.
 */
async function hydrateDecryptedMetadata<T extends Collection>(collection: T): Promise<T> {
  collection.locked = false
  if (!isOwnCollection(collection)) openShareEnvelope(collection)

  const source = await collectionKeySource(collection)
  if (!collection.metadataEncrypted) {
    if (collection.scheme === 'user-e2ee' && !source) collection.locked = true
    return collection
  }

  try {
    if (!source) throw new Error('No key to this collection on this device')
    stampMetadata(
      collection,
      decryptCollectionMetadata({
        envelope: collection.metadataEncrypted,
        source,
        userId: collection.userId,
        collectionId: collection.id,
        keyVersion: collection.metadataKeyVersion,
      }),
    )
  } catch {
    markUnreadable(collection)
    return collection
  }
  if (collection.scheme === 'server-key' && isOwnCollection(collection)) {
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

  /** Seal metadata for a user-e2ee collection. Throws when it is locked here. */
  async function buildMetadataEnvelope(
    collection: Collection,
    metadata: CollectionMetadata,
  ): Promise<string> {
    const source = await collectionKeySource(collection)
    if (!source) throw new Error('No key to this collection on this device')
    return encryptCollectionMetadata({
      metadata,
      source,
      userId: collection.userId,
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
          return hydrateDecryptedMetadata(c)
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

      const hydrated = await hydrateDecryptedMetadata(collection)
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
        created = await hydrateDecryptedMetadata({ ...sealed, role: 'owner' })
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
      const hydrated = await hydrateDecryptedMetadata({
        ...(response.data as Collection),
        role: current.role,
      })

      collectionsStore.updateCollection(hydrated)

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

    const hydrated = await hydrateDecryptedMetadata({
      ...switched,
      role: collection.role,
    })
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
      const source = await collectionKeySource(collection)
      if (!source) {
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
              source,
              ownerUserId: collection.userId,
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

  /** Decrypt every private collection this device can open, own or shared. */
  async function loadPrivatePoints() {
    await Promise.all(
      collectionsStore.collections
        .filter(c => c.scheme === 'user-e2ee' && !c.locked)
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
    collectionKeySource,
    collectionKey,
    fetchPublicCollection,
    createEncryptedPoint,
    deleteEncryptedPoint,
  }
})
