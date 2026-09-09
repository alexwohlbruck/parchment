/**
 * Collection-key rotation orchestrator.
 *
 * Runs on the owner's device when a user-e2ee collection's share set
 * changes in a way that needs to invalidate old keys — primarily when a
 * recipient is removed and we want the revoke to actually revoke (not
 * just delete a row while leaving the recipient's cached key valid).
 *
 * The flow in order:
 *
 *   1. Decrypt the current metadata + every encrypted point under the
 *      current key (version N, derived from the seed).
 *   2. Advance to version N+1 — derive a fresh key.
 *   3. Re-encrypt metadata + points under the new key.
 *   4. For each remaining recipient, ECIES-wrap the new key for their
 *      X25519 pubkey. Revoked recipients are not rewrapped; their share
 *      row is deleted in the same batch.
 *   5. POST the whole batch to the `/rotate-key` endpoint. The server
 *      runs it as a single DB transaction so no caller sees a
 *      half-rotated collection.
 *
 * The server is opaque to the whole process — it just swaps ciphertext.
 *
 * Analogous shape to `km-rotation.ts`; the two should be kept visually
 * similar when either is edited.
 */

import { api } from '@/lib/api'
import {
  deriveCollectionKey,
  encryptForFriend,
  importPublicKey,
} from './federation-crypto'
import { encryptEnvelopeString, decryptEnvelopeString } from './crypto-envelope'
import { getSeed } from './key-storage'
import type { Collection } from '@/types/library.types'

/** One point in the collection, as fetched from the server. */
export interface EncryptedPointRow {
  id: string
  encryptedData: string
  nonce: string
}

/** One outgoing share on the collection, as fetched from the server. */
export interface OutgoingShareRow {
  id: string
  recipientHandle: string
  /** Friend's long-term X25519 pubkey (base64). Needed to rewrap. */
  recipientEncryptionKey: string
}

/** What the caller passes in. All the server-side state is already fetched. */
export interface RotateCollectionKeyInput {
  collection: Collection
  ownerUserId: string
  /** Current encrypted points in the collection. Fetched by caller. */
  currentPoints: EncryptedPointRow[]
  /** Remaining recipients AFTER the revoke. */
  remainingShares: OutgoingShareRow[]
  /** Friend handles being revoked. Their shares are deleted in the batch. */
  revokeRecipientHandles: string[]
  /**
   * Owner's long-term X25519 private key. Used as the static-DH sender
   * key when rewrapping the new collection key for each recipient. The
   * owner's identity store already holds this; pass it in so this
   * function stays side-effect-free beyond the single HTTP call.
   */
  ownerEncryptionPrivateKey: Uint8Array
  /** Optional: UI hook for progress indication. */
  onProgress?: (phase: RotationPhase, pctInPhase: number) => void
}

export type RotationPhase =
  | 'decrypting'
  | 'encrypting'
  | 'rewrapping'
  | 'committing'
  | 'done'

/**
 * AAD used for the metadata + point envelopes on a collection. Matches the
 * binding the existing library-crypto uses (see `library-crypto.ts`).
 */
function aadFor(
  collectionId: string,
  recordType: 'collection-metadata' | 'encrypted-point',
  recordId: string,
  userId: string,
) {
  return {
    userId,
    recordType,
    recordId,
    keyContext: `parchment-collection-${collectionId}`,
  }
}

/**
 * Run the full rotate-on-revoke flow. Returns the server's view of the
 * updated collection on success.
 */
export async function rotateCollectionKey(
  input: RotateCollectionKeyInput,
): Promise<Collection> {
  const {
    collection,
    ownerUserId,
    currentPoints,
    remainingShares,
    revokeRecipientHandles,
    ownerEncryptionPrivateKey,
    onProgress,
  } = input

  const seed = await getSeed()
  if (!seed) throw new Error('No seed — cannot rotate collection key')

  const oldVersion = collection.metadataKeyVersion ?? 1
  const newVersion = oldVersion + 1
  const oldKey = deriveCollectionKey(seed, collection.id, oldVersion)
  const newKey = deriveCollectionKey(seed, collection.id, newVersion)

  // ---- Phase 1: decrypt everything under the old key ----
  onProgress?.('decrypting', 0)
  const plaintextPoints = currentPoints.map((p, i) => {
    const plaintext = decryptEnvelopeString({
      envelope: p.encryptedData,
      key: oldKey,
      aad: aadFor(collection.id, 'encrypted-point', p.id, ownerUserId),
    })
    onProgress?.('decrypting', (i + 1) / Math.max(1, currentPoints.length))
    return { id: p.id, plaintext }
  })

  const metadataPlaintext = collection.metadataEncrypted
    ? decryptEnvelopeString({
        envelope: collection.metadataEncrypted,
        key: oldKey,
        aad: aadFor(
          collection.id,
          'collection-metadata',
          collection.id,
          ownerUserId,
        ),
      })
    : ''

  // ---- Phase 2: re-encrypt everything under the new key ----
  onProgress?.('encrypting', 0)
  const newMetadataEncrypted = metadataPlaintext
    ? encryptEnvelopeString({
        plaintext: metadataPlaintext,
        key: newKey,
        aad: aadFor(
          collection.id,
          'collection-metadata',
          collection.id,
          ownerUserId,
        ),
      })
    : ''

  const newEncryptedPoints = plaintextPoints.map((p, i) => {
    const envelope = encryptEnvelopeString({
      plaintext: p.plaintext,
      key: newKey,
      aad: aadFor(collection.id, 'encrypted-point', p.id, ownerUserId),
    })
    onProgress?.('encrypting', (i + 1) / Math.max(1, plaintextPoints.length))
    return { id: p.id, encryptedData: envelope, nonce: '' }
  })

  // ---- Phase 3: rewrap the new key for each remaining recipient ----
  //
  // We wrap the raw 32 bytes of the new key itself; the friend decrypts to
  // get the key back, then uses it for subsequent point + metadata reads.
  // The v1 `encryptForFriend` path is used because current shares carry
  // v1-shaped envelopes (ciphertext + nonce). A migration to v2 is tracked
  // as a follow-up.
  onProgress?.('rewrapping', 0)
  const newKeyB64 = btoa(String.fromCharCode(...newKey))
  const updatedShareEnvelopes = remainingShares.map((s, i) => {
    const friendPub = importPublicKey(s.recipientEncryptionKey)
    const wrapped = encryptForFriend(
      newKeyB64,
      ownerEncryptionPrivateKey,
      friendPub,
      `parchment-collection-key-wrap:${collection.id}`,
    )
    onProgress?.('rewrapping', (i + 1) / Math.max(1, remainingShares.length))
    return {
      recipientHandle: s.recipientHandle,
      encryptedData: wrapped.ciphertext,
      nonce: wrapped.nonce,
    }
  })

  // ---- Phase 4: commit server-side in one transaction ----
  onProgress?.('committing', 0)
  const { data } = await api.post<Collection>(
    `/library/collections/${collection.id}/rotate-key`,
    {
      newMetadataEncrypted,
      newMetadataKeyVersion: newVersion,
      newEncryptedPoints,
      updatedShareEnvelopes,
      revokeRecipientHandles,
    },
  )
  onProgress?.('committing', 1)
  onProgress?.('done', 1)
  return data
}

