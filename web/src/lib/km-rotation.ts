/**
 * Client-side K_m (master-key) rotation orchestrator.
 *
 * Flow:
 *   1. Generate a new 32-byte seed + derived signing/encryption keys.
 *   2. Re-encrypt every personal blob under the NEW seed's personal key.
 *      (In-memory — not uploaded yet.)
 *   3. Re-encrypt every collection's metadata envelope under the NEW
 *      per-collection key. (In-memory.)
 *   4. Re-seal K_m into every existing passkey-PRF slot. One biometric
 *      tap per slot, each scoped to that slot's credentialId (server
 *      restricts `allowCredentials` so the user can't accidentally tap
 *      the wrong passkey).
 *   5. Single atomic POST to `/users/me/km-version/commit` with the
 *      full post-rotation state + expectedCurrent (CAS). Server
 *      applies everything inside one DB transaction — on conflict
 *      (409) NOTHING is written. No partial state possible.
 *   6. On success, replace the locally-stored seed.
 *
 * The atomic commit replaces the previous sequential-PUT approach that
 * could leave the server holding the loser's public keys + mixed data
 * if the CAS lost the race.
 *
 * Out of scope for this pass: per-canvas metadata. Canvas UI isn't wired
 * yet, so there's nothing for users to lose when we skip canvas re-
 * encryption here. Wire it in alongside the canvas feature.
 */

import { api } from '@/lib/api'
import {
  generateSeed,
  deriveAllKeys,
  derivePersonalKey,
  exportPublicKey,
  PERSONAL_KEY_CONTEXT,
  type DerivedKeys,
} from '@/lib/federation-crypto'
import {
  encryptEnvelopeString,
  decryptEnvelopeString,
  type AAD,
} from '@/lib/crypto-envelope'
import {
  encryptCollectionMetadata,
  decryptCollectionMetadata,
} from '@/lib/library-crypto'
import {
  buildWrappedKmSlot,
  type WrappedKmSlot,
} from '@/lib/passkey-prf'
import { extractPrfOutputFromAssertion } from '@/lib/passkey-prf-support'
import { storeSeed } from '@/lib/key-storage'

interface BlobListEntry {
  blobType: string
  kmVersion: number
}

interface ServerBlobValue {
  encryptedBlob: string
  nonce: string
  kmVersion: number
  updatedAt: string
}

interface ServerCollection {
  id: string
  metadataEncrypted: string | null
}

/**
 * Lifecycle events for the UI to render a progress indicator.
 */
export type RotationPhase =
  | { kind: 'starting' }
  | { kind: 'listing-data' }
  | { kind: 'reencrypt-blob'; blobType: string; index: number; total: number }
  | {
      kind: 'reencrypt-collection'
      collectionId: string
      index: number
      total: number
    }
  | {
      kind: 'resealing-slot'
      credentialId: string
      index: number
      total: number
    }
  | { kind: 'committing' }
  | { kind: 'storing-seed' }
  | { kind: 'done'; newKmVersion: number }

export class RotationConflictError extends Error {
  constructor() {
    super(
      'Another device rotated your keys first. Sign out and back in so this ' +
        'device picks up the latest keys, then try again if still needed.',
    )
    this.name = 'RotationConflictError'
  }
}

interface RotateParams {
  userId: string
  oldSeed: Uint8Array
  currentKmVersion: number
  /**
   * Assertion ceremony scoped to a specific credentialId — server
   * restricts `allowCredentials` to that one passkey so the user can't
   * accidentally tap the wrong one and leave slot N unsresealed.
   * Resolves to the simplewebauthn AuthenticationResponseJSON; we read
   * `clientExtensionResults.prf.results.first` off it.
   */
  assertPasskeyForSlot: (credentialId: string) => Promise<unknown>
  onProgress?: (phase: RotationPhase) => void
}

interface RotateResult {
  newSeed: Uint8Array
  newKeys: DerivedKeys
  newKmVersion: number
  slotResults: Array<{
    credentialId: string
    ok: boolean
    reason?: 'no-prf' | 'sign-failed'
  }>
}

interface PreparedBlob {
  blobType: string
  encryptedBlob: string
}
interface PreparedCollection {
  id: string
  metadataEncrypted: string
}

export async function rotateMasterKey(
  params: RotateParams,
): Promise<RotateResult> {
  const progress = (p: RotationPhase) => params.onProgress?.(p)
  progress({ kind: 'starting' })

  const newSeed = generateSeed()
  const newKeys = deriveAllKeys(newSeed)
  const oldPersonalKey = derivePersonalKey(params.oldSeed)
  const newPersonalKey = derivePersonalKey(newSeed)

  // 1. Rebuild every personal blob in memory (no uploads yet).
  progress({ kind: 'listing-data' })
  const listResponse = await api.get<{ blobs: BlobListEntry[] }>('/me/blobs')
  const blobs = listResponse.data.blobs ?? []
  const preparedBlobs: PreparedBlob[] = []
  for (let i = 0; i < blobs.length; i++) {
    const entry = blobs[i]
    progress({
      kind: 'reencrypt-blob',
      blobType: entry.blobType,
      index: i + 1,
      total: blobs.length,
    })
    const rebuilt = await rebuildPersonalBlob({
      userId: params.userId,
      blobType: entry.blobType,
      oldKey: oldPersonalKey,
      newKey: newPersonalKey,
    })
    if (rebuilt) preparedBlobs.push(rebuilt)
  }

  // 2. Rebuild every collection's metadata envelope.
  const collectionsResp = await api.get<ServerCollection[]>(
    '/library/collections',
  )
  const serverCollections = collectionsResp.data ?? []
  const preparedCollections: PreparedCollection[] = []
  for (let i = 0; i < serverCollections.length; i++) {
    const c = serverCollections[i]
    if (!c.metadataEncrypted) continue
    progress({
      kind: 'reencrypt-collection',
      collectionId: c.id,
      index: i + 1,
      total: serverCollections.length,
    })
    const rebuilt = rebuildCollection({
      userId: params.userId,
      collectionId: c.id,
      oldEnvelope: c.metadataEncrypted,
      oldSeed: params.oldSeed,
      newSeed,
    })
    if (rebuilt) preparedCollections.push(rebuilt)
  }

  // 3. Re-seal every slot. One tap per slot, scoped to the slot's own
  //    credentialId so the user can't mis-tap.
  const slotsResponse = await api.get<{ slots: WrappedKmSlot[] }>(
    '/users/me/wrapped-keys',
  )
  const slots = slotsResponse.data.slots ?? []
  const preparedSlots: Array<{
    credentialId: string
    wrappedKm: string
    wrapAlgo: string
    slotSignature: string
  }> = []
  const slotResults: RotateResult['slotResults'] = []
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    progress({
      kind: 'resealing-slot',
      credentialId: slot.credentialId,
      index: i + 1,
      total: slots.length,
    })
    const result = await resealSlotWithPasskey({
      userId: params.userId,
      newSeed,
      newKeys,
      slotCredentialId: slot.credentialId,
      assertPasskeyForSlot: params.assertPasskeyForSlot,
    })
    if (result.prepared) preparedSlots.push(result.prepared)
    slotResults.push(result.outcome)
  }

  // 4. Atomic commit. Either everything lands or nothing does.
  progress({ kind: 'committing' })
  let newKmVersion: number
  try {
    const response = await api.post<{ kmVersion: number }>(
      '/users/me/km-version/commit',
      {
        expectedCurrent: params.currentKmVersion,
        signingKey: exportPublicKey(newKeys.signing.publicKey),
        encryptionKey: exportPublicKey(newKeys.encryption.publicKey),
        blobs: preparedBlobs,
        collections: preparedCollections,
        slots: preparedSlots,
      },
    )
    newKmVersion = response.data.kmVersion
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status === 409) throw new RotationConflictError()
    throw err
  }

  // 5. Persist the new seed locally. If this fails after a successful
  //    commit the server is authoritative; user can recover via a
  //    passkey unlock on this device (which unwraps from a just-
  //    re-sealed slot).
  progress({ kind: 'storing-seed' })
  await storeSeed(newSeed)

  progress({ kind: 'done', newKmVersion })
  return { newSeed, newKeys, newKmVersion, slotResults }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function personalBlobAad(userId: string, blobType: string): AAD {
  return {
    userId,
    recordType: 'personal-blob',
    recordId: blobType,
    keyContext: PERSONAL_KEY_CONTEXT,
  }
}

function rebuildCollection(params: {
  userId: string
  collectionId: string
  oldEnvelope: string
  oldSeed: Uint8Array
  newSeed: Uint8Array
}): PreparedCollection | null {
  let metadata
  try {
    metadata = decryptCollectionMetadata({
      envelope: params.oldEnvelope,
      seed: params.oldSeed,
      userId: params.userId,
      collectionId: params.collectionId,
    })
  } catch {
    // Can't decrypt with old seed (already under new seed, or tampered).
    // Skip rather than overwrite with garbage.
    return null
  }
  const metadataEncrypted = encryptCollectionMetadata({
    metadata,
    seed: params.newSeed,
    userId: params.userId,
    collectionId: params.collectionId,
  })
  return { id: params.collectionId, metadataEncrypted }
}

async function rebuildPersonalBlob(params: {
  userId: string
  blobType: string
  oldKey: Uint8Array
  newKey: Uint8Array
}): Promise<PreparedBlob | null> {
  const encodedType = encodeURIComponent(params.blobType)
  let envelope: ServerBlobValue
  try {
    const { data } = await api.get<ServerBlobValue>(`/me/blobs/${encodedType}`)
    envelope = data
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status === 404) return null // disappeared between list + fetch
    throw err
  }
  let plaintext: string
  try {
    plaintext = decryptEnvelopeString({
      envelope: envelope.encryptedBlob,
      key: params.oldKey,
      aad: personalBlobAad(params.userId, params.blobType),
    })
  } catch {
    // Not decryptable with our old key — maybe already under new seed
    // from a parallel rotation. Skip; don't upload garbage.
    return null
  }
  const newEnvelope = encryptEnvelopeString({
    plaintext,
    key: params.newKey,
    aad: personalBlobAad(params.userId, params.blobType),
  })
  return { blobType: params.blobType, encryptedBlob: newEnvelope }
}

async function resealSlotWithPasskey(params: {
  userId: string
  newSeed: Uint8Array
  newKeys: DerivedKeys
  slotCredentialId: string
  assertPasskeyForSlot: (credentialId: string) => Promise<unknown>
}): Promise<{
  prepared: {
    credentialId: string
    wrappedKm: string
    wrapAlgo: string
    slotSignature: string
  } | null
  outcome: RotateResult['slotResults'][number]
}> {
  let assertion: unknown
  try {
    assertion = await params.assertPasskeyForSlot(params.slotCredentialId)
  } catch {
    return {
      prepared: null,
      outcome: {
        credentialId: params.slotCredentialId,
        ok: false,
        reason: 'no-prf',
      },
    }
  }

  const prfOutput = extractPrfOutputFromAssertion(
    assertion as {
      clientExtensionResults?: {
        prf?: {
          results?: { first?: ArrayBuffer | ArrayBufferView | string }
        }
      }
    },
  )
  if (!prfOutput) {
    return {
      prepared: null,
      outcome: {
        credentialId: params.slotCredentialId,
        ok: false,
        reason: 'no-prf',
      },
    }
  }

  try {
    const slot = await buildWrappedKmSlot({
      seed: params.newSeed,
      prfOutput,
      userId: params.userId,
      credentialId: params.slotCredentialId,
      identitySigningPrivateKey: params.newKeys.signing.privateKey,
    })
    return {
      prepared: {
        credentialId: slot.credentialId,
        wrappedKm: slot.wrappedKm,
        wrapAlgo: slot.wrapAlgo,
        slotSignature: slot.slotSignature,
      },
      outcome: { credentialId: params.slotCredentialId, ok: true },
    }
  } catch {
    return {
      prepared: null,
      outcome: {
        credentialId: params.slotCredentialId,
        ok: false,
        reason: 'sign-failed',
      },
    }
  }
}
