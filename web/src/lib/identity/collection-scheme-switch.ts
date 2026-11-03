/**
 * Collection scheme-switch orchestrator.
 *
 * Bidirectional conversion between `server-key` and `user-e2ee` collections.
 * Runs entirely on the owner's device — decrypts/encrypts every
 * bookmark/point under the correct key, rewraps share envelopes, and ships
 * the whole batch to `POST /library/collections/:id/change-scheme`. The
 * server applies it atomically.
 *
 * Mirrors `collection-rotation.ts` in shape. The two differ only in the
 * direction of the data transform (bookmarks ↔ encrypted_points).
 */

import { api } from '@/lib/api'
import { deriveCollectionKey } from './federation-crypto'
import { sealForRecipients } from './collection-share'
import {
  collectionMetadataOf,
  decryptCollectionPoint,
  encryptCollectionMetadata,
  encryptCollectionPoint,
} from './library-crypto'
import { getSeed } from './key-storage'
import type { Collection, CollectionScheme } from '@/types/library.types'

/** Existing cleartext bookmark as returned by the library API. */
export interface ClearBookmarkRow {
  id: string
  externalIds: Record<string, string>
  name: string
  address?: string | null
  lat: number
  lng: number
  icon: string
  iconPack?: 'lucide' | 'maki'
  iconColor: string
  frequentType?: string | null
}

/** Existing encrypted point as returned by the library API. */
export interface EncryptedPointRow {
  id: string
  encryptedData: string
  nonce: string
}

/** One outgoing share on the collection that needs its envelope rewrapped. */
export interface OutgoingShareRow {
  id: string
  recipientHandle: string
  recipientEncryptionKey: string
}

export type SwitchPhase = 'transforming' | 'rewrapping' | 'committing' | 'done'

export interface SwitchUpgradeInput {
  collection: Collection
  ownerUserId: string
  /** Cleartext bookmarks currently in the collection. */
  currentBookmarks: ClearBookmarkRow[]
  remainingShares: OutgoingShareRow[]
  ownerEncryptionPrivateKey: Uint8Array
  onProgress?: (phase: SwitchPhase, pctInPhase: number) => void
}

export interface SwitchDowngradeInput {
  collection: Collection
  ownerUserId: string
  /** Encrypted points currently in the collection. */
  currentPoints: EncryptedPointRow[]
  remainingShares: OutgoingShareRow[]
  ownerEncryptionPrivateKey: Uint8Array
  onProgress?: (phase: SwitchPhase, pctInPhase: number) => void
}

/**
 * server-key → user-e2ee. Every current cleartext bookmark, and the
 * collection's own metadata, is encrypted under the new collection key.
 * After the switch the server holds no cleartext for the collection.
 *
 * `collection` must be hydrated: its metadata fields are what gets sealed.
 */
export async function upgradeCollectionToE2ee(
  input: SwitchUpgradeInput,
): Promise<Collection> {
  const {
    collection,
    ownerUserId,
    currentBookmarks,
    remainingShares,
    ownerEncryptionPrivateKey,
    onProgress,
  } = input

  const seed = await getSeed()
  if (!seed) throw new Error('No seed — cannot switch collection scheme')

  const newVersion = (collection.metadataKeyVersion ?? 1) + 1
  const newKey = deriveCollectionKey(seed, collection.id, newVersion)

  // ---- Phase 1: encrypt bookmarks as encrypted_points under the new key ----
  onProgress?.('transforming', 0)
  const newEncryptedPoints = currentBookmarks.map((bm, i) => {
    const envelope = encryptCollectionPoint({
      point: { ...bm, iconPack: bm.iconPack ?? 'lucide' },
      pointId: bm.id,
      source: { seed },
      ownerUserId,
      collectionId: collection.id,
      keyVersion: newVersion,
    })
    onProgress?.('transforming', (i + 1) / Math.max(1, currentBookmarks.length))
    return { id: bm.id, encryptedData: envelope, nonce: '' }
  })

  const newMetadataEncrypted = encryptCollectionMetadata({
    metadata: collectionMetadataOf(collection),
    source: { seed },
    userId: ownerUserId,
    collectionId: collection.id,
    keyVersion: newVersion,
  })

  // ---- Phase 2: rewrap share keys for remaining recipients ----
  onProgress?.('rewrapping', 0)
  const updatedShareEnvelopes = sealForRecipients({
    share: {
      collectionId: collection.id,
      scheme: 'user-e2ee',
      key: newKey,
      keyVersion: newVersion,
    },
    ownerPrivateKey: ownerEncryptionPrivateKey,
    recipients: remainingShares,
    onEach: (done, total) => onProgress?.('rewrapping', done / total),
  })

  // ---- Phase 3: commit atomically ----
  onProgress?.('committing', 0)
  const { data } = await api.post<Collection>(
    `/library/collections/${collection.id}/change-scheme`,
    {
      targetScheme: 'user-e2ee' as CollectionScheme,
      newMetadataEncrypted,
      newMetadataKeyVersion: newVersion,
      newEncryptedPoints,
      updatedShareEnvelopes,
    },
  )
  onProgress?.('done', 1)
  return data
}

/**
 * user-e2ee → server-key. Every current encrypted_point is decrypted under
 * the current key; its plaintext payload is shipped to the server as a
 * fresh bookmark row, and the hydrated metadata moves to cleartext columns.
 * Encrypted points and the metadata envelope are dropped on the server.
 *
 * This is a trust downgrade — the server starts seeing every point in
 * cleartext. The UI should confirm loudly before running this.
 */
export async function downgradeCollectionToServerKey(
  input: SwitchDowngradeInput,
): Promise<Collection> {
  const {
    collection,
    ownerUserId,
    currentPoints,
    remainingShares,
    ownerEncryptionPrivateKey,
    onProgress,
  } = input

  const seed = await getSeed()
  if (!seed) throw new Error('No seed — cannot switch collection scheme')

  const oldVersion = collection.metadataKeyVersion ?? 1
  const newVersion = oldVersion + 1

  // ---- Phase 1: decrypt each point into a plaintext bookmark payload ----
  onProgress?.('transforming', 0)
  const newBookmarks = currentPoints.map((p, i) => {
    const point = decryptCollectionPoint({
      point: p,
      source: { seed },
      ownerUserId,
      collectionId: collection.id,
      keyVersion: oldVersion,
    })
    onProgress?.('transforming', (i + 1) / Math.max(1, currentPoints.length))
    return {
      id: point.id,
      externalIds: point.externalIds,
      name: point.name,
      address: point.address ?? null,
      lat: point.lat,
      lng: point.lng,
      icon: point.icon,
      iconPack: point.iconPack,
      iconColor: point.iconColor,
      frequentType: point.frequentType ?? null,
    }
  })

  // ---- Phase 2: rewrap share keys for remaining recipients ----
  onProgress?.('rewrapping', 0)
  const updatedShareEnvelopes = sealForRecipients({
    share: { collectionId: collection.id, scheme: 'server-key' },
    ownerPrivateKey: ownerEncryptionPrivateKey,
    recipients: remainingShares,
    onEach: (done, total) => onProgress?.('rewrapping', done / total),
  })

  onProgress?.('committing', 0)
  const { data } = await api.post<Collection>(
    `/library/collections/${collection.id}/change-scheme`,
    {
      targetScheme: 'server-key' as CollectionScheme,
      metadata: collectionMetadataOf(collection),
      newMetadataKeyVersion: newVersion,
      newBookmarks,
      updatedShareEnvelopes,
    },
  )
  onProgress?.('done', 1)
  return data
}
