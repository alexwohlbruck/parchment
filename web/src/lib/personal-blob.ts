/**
 * Client-side personal-blob sync.
 *
 * Generic helper for "I have a JSON value; encrypt it under my personal key
 * with v2 envelope AAD binding and round-trip it through the server's
 * /users/me/blobs/:type endpoint."
 *
 * Server sees only ciphertext. Every blob type gets its own AAD recordType
 * so cross-type confusion fails AEAD.
 *
 * Usage:
 *   await loadBlob<SearchHistory>('search-history', userId) → decrypted value or null
 *   await saveBlob('search-history', userId, value)          → encrypts + uploads
 */

import { api } from '@/lib/api'
import {
  encryptEnvelopeString,
  decryptEnvelopeString,
  type AAD,
} from './crypto-envelope'
import { derivePersonalKey } from './federation-crypto'
import { getSeed } from './key-storage'

const PERSONAL_KEY_CONTEXT = 'parchment-personal-v1'
const KM_VERSION_CURRENT = 1

function buildBlobAAD(params: {
  userId: string
  blobType: string
}): AAD {
  return {
    userId: params.userId,
    recordType: 'personal-blob',
    recordId: params.blobType,
    keyContext: PERSONAL_KEY_CONTEXT,
  }
}

export interface BlobEnvelope {
  encryptedBlob: string
  nonce: string
  kmVersion: number
  updatedAt: string
}

/**
 * Encrypt a JSON-serializable value and upload as the named blob.
 */
export async function saveBlob<T>(
  blobType: string,
  userId: string,
  value: T,
): Promise<void> {
  const seed = await getSeed()
  if (!seed) throw new Error('No identity seed — cannot save personal blob')
  const key = derivePersonalKey(seed)
  const envelope = encryptEnvelopeString({
    plaintext: JSON.stringify(value),
    key,
    aad: buildBlobAAD({ userId, blobType }),
  })
  await api.put(`/me/blobs/${encodeURIComponent(blobType)}`, {
    encryptedBlob: envelope,
    nonce: '', // v2 envelope carries its own nonce internally
    kmVersion: KM_VERSION_CURRENT,
  })
}

/**
 * Fetch + decrypt a named blob. Returns null if the blob doesn't exist
 * (new user, never synced) or decryption fails (seed rotated, etc.).
 */
export async function loadBlob<T>(
  blobType: string,
  userId: string,
): Promise<T | null> {
  const seed = await getSeed()
  if (!seed) return null

  let envelope: BlobEnvelope
  try {
    const { data } = await api.get(
      `/me/blobs/${encodeURIComponent(blobType)}`,
    )
    envelope = data as BlobEnvelope
  } catch (err: any) {
    if (err?.response?.status === 404) return null
    throw err
  }

  try {
    const key = derivePersonalKey(seed)
    const plaintext = decryptEnvelopeString({
      envelope: envelope.encryptedBlob,
      key,
      aad: buildBlobAAD({ userId, blobType }),
    })
    return JSON.parse(plaintext) as T
  } catch {
    // Decrypt failed — treat as "no usable blob" and let caller recover.
    return null
  }
}

export async function deleteBlob(blobType: string): Promise<void> {
  try {
    await api.delete(`/me/blobs/${encodeURIComponent(blobType)}`)
  } catch (err: any) {
    if (err?.response?.status === 404) return
    throw err
  }
}

/**
 * Decrypt a v2 envelope that was delivered alongside some other response
 * (e.g. inline in the integrations hydrate) instead of fetched separately.
 * Uses the same AAD binding as saveBlob/loadBlob so envelopes produced by
 * either path are interchangeable.
 *
 * Returns null if the seed is unavailable or decryption fails — callers
 * treat that as "no usable blob" and carry on.
 */
export async function decryptBlobEnvelope<T>(
  blobType: string,
  userId: string,
  envelope: string,
): Promise<T | null> {
  const seed = await getSeed()
  if (!seed) return null
  try {
    const key = derivePersonalKey(seed)
    const plaintext = decryptEnvelopeString({
      envelope,
      key,
      aad: buildBlobAAD({ userId, blobType }),
    })
    return JSON.parse(plaintext) as T
  } catch {
    return null
  }
}
