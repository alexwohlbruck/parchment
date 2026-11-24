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
import {
  deriveAllKeys,
  derivePersonalKey,
  exportPublicKey,
  PERSONAL_KEY_CONTEXT,
} from './federation-crypto'
import { getSeed } from './key-storage'

/** This device's seed is older than the account's keys, so writing would strand data. */
export class StaleKeysError extends Error {
  constructor() {
    super('Your keys changed on another device. Unlock them on this device before saving.')
    this.name = 'StaleKeysError'
  }
}

/** The stored blob won't open with this device's seed. */
export class BlobUnreadableError extends Error {
  constructor(blobType: string) {
    super(`Couldn't decrypt ${blobType} with this device's keys`)
    this.name = 'BlobUnreadableError'
  }
}

let seedKmVersion: number | null = null

/** Forget the cached key version, after this device's seed changes. */
export function resetBlobKeyVersion(): void {
  seedKmVersion = null
}

/** The account's key version, once confirmed to be the one this seed belongs to. */
async function kmVersionForSeed(seed: Uint8Array): Promise<number> {
  if (seedKmVersion !== null) return seedKmVersion
  const { data } = await api.get<{ signingKey: string | null; kmVersion: number }>(
    '/users/me/identity',
  )
  const ownSigningKey = exportPublicKey(deriveAllKeys(seed).signing.publicKey)
  if (data.signingKey !== ownSigningKey) throw new StaleKeysError()
  seedKmVersion = data.kmVersion
  return seedKmVersion
}

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
  const kmVersion = await kmVersionForSeed(seed)
  try {
    await api.put(`/me/blobs/${encodeURIComponent(blobType)}`, {
      encryptedBlob: envelope,
      nonce: '',
      kmVersion,
    })
  } catch (err) {
    if ((err as { response?: { status?: number } })?.response?.status === 409) {
      resetBlobKeyVersion()
      throw new StaleKeysError()
    }
    throw err
  }
}

/**
 * Fetch + decrypt a named blob. Returns null if the blob doesn't exist
 * (new user, never synced). Throws `BlobUnreadableError` when it exists
 * but won't decrypt, so a caller never mistakes it for empty and
 * overwrites it.
 */
export async function loadBlob<T>(
  blobType: string,
  userId: string,
): Promise<T | null> {
  const seed = await getSeed()
  if (!seed) return null

  let envelope: BlobEnvelope
  try {
    const res = await api.get(`/me/blobs/${encodeURIComponent(blobType)}`)
    // 204 (No Content) — the server has no blob of this type yet. Empty body
    // is the same signal. (404 kept below for back-compat with older servers.)
    if (res.status === 204 || !res.data) return null
    envelope = res.data as BlobEnvelope
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
    throw new BlobUnreadableError(blobType)
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
