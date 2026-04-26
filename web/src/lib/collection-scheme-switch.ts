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
import {
  deriveCollectionKey,
  encryptForFriend,
  importPublicKey,
} from './federation-crypto'
import { encryptEnvelopeString, decryptEnvelopeString } from './crypto-envelope'
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
  iconColor: string
  presetType?: string | null
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

function pointAAD(
  collectionId: string,
  pointId: string,
  ownerUserId: string,
) {
  return {
    userId: ownerUserId,
    recordType: 'encrypted-point' as const,
    recordId: pointId,
    keyContext: `parchment-collection-${collectionId}`,
  }
}

function metaAAD(collectionId: string, ownerUserId: string) {
  return {
    userId: ownerUserId,
    recordType: 'collection-metadata' as const,
    recordId: collectionId,
    keyContext: `parchment-collection-${collectionId}`,
  }
}

function wrapKeyForFriend(params: {
  keyBytes: Uint8Array
  ownerPrivate: Uint8Array
  recipientPublicKey: string
  collectionId: string
}): { encryptedData: string; nonce: string } {
  const friendPub = importPublicKey(params.recipientPublicKey)
  const b64 = btoa(String.fromCharCode(...params.keyBytes))
  const wrapped = encryptForFriend(
    b64,
    params.ownerPrivate,
    friendPub,
    `parchment-collection-key-wrap:${params.collectionId}`,
  )
  return { encryptedData: wrapped.ciphertext, nonce: wrapped.nonce }
}

/**
 * server-key → user-e2ee. Every current cleartext bookmark is encrypted
 * under the new collection key and sent as an encrypted_points batch.
 * After the switch the cleartext rows are deleted on the server.
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
    const plaintext = JSON.stringify({
      externalIds: bm.externalIds,
      name: bm.name,
      address: bm.address ?? null,
      lat: bm.lat,
      lng: bm.lng,
      icon: bm.icon,
      iconColor: bm.iconColor,
      presetType: bm.presetType ?? null,
    })
    const envelope = encryptEnvelopeString({
      plaintext,
      key: newKey,
      aad: pointAAD(collection.id, bm.id, ownerUserId),
    })
    onProgress?.('transforming', (i + 1) / Math.max(1, currentBookmarks.length))
    return { id: bm.id, encryptedData: envelope, nonce: '' }
  })

  // Re-encrypt metadata under the new key.
  const newMetadataEncrypted = collection.metadataEncrypted
    ? reEncryptMetadata({
        seed,
        oldVersion: collection.metadataKeyVersion ?? 1,
        newKey,
        collectionId: collection.id,
        ownerUserId,
        existingEnvelope: collection.metadataEncrypted,
      })
    : encryptEnvelopeString({
        plaintext: JSON.stringify({}),
        key: newKey,
        aad: metaAAD(collection.id, ownerUserId),
      })

  // ---- Phase 2: rewrap share keys for remaining recipients ----
  onProgress?.('rewrapping', 0)
  const updatedShareEnvelopes = remainingShares.map((s, i) => {
    const wrapped = wrapKeyForFriend({
      keyBytes: newKey,
      ownerPrivate: ownerEncryptionPrivateKey,
      recipientPublicKey: s.recipientEncryptionKey,
      collectionId: collection.id,
    })
    onProgress?.('rewrapping', (i + 1) / Math.max(1, remainingShares.length))
    return {
      recipientHandle: s.recipientHandle,
      encryptedData: wrapped.encryptedData,
      nonce: wrapped.nonce,
    }
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
 * fresh bookmark row. Encrypted points are dropped on the server.
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
  const oldKey = deriveCollectionKey(seed, collection.id, oldVersion)
  const newKey = deriveCollectionKey(seed, collection.id, newVersion)

  // ---- Phase 1: decrypt each point into a plaintext bookmark payload ----
  onProgress?.('transforming', 0)
  const newBookmarks = currentPoints.map((p, i) => {
    const plaintext = decryptEnvelopeString({
      envelope: p.encryptedData,
      key: oldKey,
      aad: pointAAD(collection.id, p.id, ownerUserId),
    })
    const parsed = JSON.parse(plaintext) as {
      externalIds?: Record<string, string>
      name?: string
      address?: string | null
      lat: number
      lng: number
      icon?: string
      iconColor?: string
      presetType?: string | null
    }
    onProgress?.('transforming', (i + 1) / Math.max(1, currentPoints.length))
    return {
      id: p.id,
      externalIds: parsed.externalIds ?? {},
      name: parsed.name ?? '',
      address: parsed.address ?? null,
      lat: parsed.lat,
      lng: parsed.lng,
      icon: parsed.icon,
      iconColor: parsed.iconColor,
      presetType: parsed.presetType ?? null,
    }
  })

  // Re-encrypt metadata under the new key version (still e2ee for the
  // envelope itself — only the points downgrade to cleartext).
  const newMetadataEncrypted = collection.metadataEncrypted
    ? reEncryptMetadata({
        seed,
        oldVersion,
        newKey,
        collectionId: collection.id,
        ownerUserId,
        existingEnvelope: collection.metadataEncrypted,
      })
    : encryptEnvelopeString({
        plaintext: JSON.stringify({}),
        key: newKey,
        aad: metaAAD(collection.id, ownerUserId),
      })

  // ---- Phase 2: rewrap share keys for remaining recipients ----
  onProgress?.('rewrapping', 0)
  const updatedShareEnvelopes = remainingShares.map((s, i) => {
    const wrapped = wrapKeyForFriend({
      keyBytes: newKey,
      ownerPrivate: ownerEncryptionPrivateKey,
      recipientPublicKey: s.recipientEncryptionKey,
      collectionId: collection.id,
    })
    onProgress?.('rewrapping', (i + 1) / Math.max(1, remainingShares.length))
    return {
      recipientHandle: s.recipientHandle,
      encryptedData: wrapped.encryptedData,
      nonce: wrapped.nonce,
    }
  })

  onProgress?.('committing', 0)
  const { data } = await api.post<Collection>(
    `/library/collections/${collection.id}/change-scheme`,
    {
      targetScheme: 'server-key' as CollectionScheme,
      newMetadataEncrypted,
      newMetadataKeyVersion: newVersion,
      newBookmarks,
      updatedShareEnvelopes,
    },
  )
  onProgress?.('done', 1)
  return data
}

/**
 * Unwrap an existing metadata envelope under the current key and re-seal
 * it under the new key. Works for both directions of the switch since
 * metadata stays encrypted in both schemes.
 */
function reEncryptMetadata(params: {
  seed: Uint8Array
  oldVersion: number
  newKey: Uint8Array
  collectionId: string
  ownerUserId: string
  existingEnvelope: string
}): string {
  const oldKey = deriveCollectionKey(
    params.seed,
    params.collectionId,
    params.oldVersion,
  )
  const plaintext = decryptEnvelopeString({
    envelope: params.existingEnvelope,
    key: oldKey,
    aad: metaAAD(params.collectionId, params.ownerUserId),
  })
  return encryptEnvelopeString({
    plaintext,
    key: params.newKey,
    aad: metaAAD(params.collectionId, params.ownerUserId),
  })
}
