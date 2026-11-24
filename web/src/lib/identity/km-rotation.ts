/**
 * Client-side K_m (master-key) rotation orchestrator.
 *
 * Flow:
 *   1. Generate a new 32-byte seed + derived signing/encryption keys.
 *   2. Re-encrypt every personal blob under the NEW seed's personal key.
 *      (In-memory — not uploaded yet.)
 *   3. Re-encrypt every collection's metadata envelope, and every private
 *      collection's points, under the NEW per-collection key. (In-memory.)
 *   4. Re-encrypt every route and canvas (metadata and private bodies).
 *   5. Re-seal share envelopes, both the user's own private collections
 *      shared with others and collections shared with the user, since
 *      both are bound to the old encryption key.
 *   6. Re-seal K_m into every existing passkey-PRF slot. One biometric
 *      tap per slot, each scoped to that slot's credentialId.
 *   7. Show the new recovery key and wait for the user to confirm it.
 *   8. Single atomic POST to `/users/me/km-version/commit` with the
 *      full post-rotation state + expectedCurrent (CAS). The server
 *      refuses a commit that misses any seed-derived record.
 *   9. On success, replace the locally-stored seed.
 *
 * Anything that won't decrypt under the old seed aborts the rotation:
 * once the old seed is gone, a skipped record is lost for good.
 */

import { api } from '@/lib/api'
import {
  generateSeed,
  deriveAllKeys,
  derivePersonalKey,
  deriveCollectionKey,
  exportPublicKey,
  exportRecoveryKey,
  importPublicKey,
  PERSONAL_KEY_CONTEXT,
  type DerivedKeys,
} from '@/lib/identity/federation-crypto'
import {
  encryptEnvelopeString,
  decryptEnvelopeString,
  type AAD,
} from '@/lib/identity/crypto-envelope'
import {
  encryptCollectionMetadata,
  decryptCollectionMetadata,
  encryptCollectionPoint,
  decryptCollectionPoint,
  encryptRouteMetadata,
  decryptRouteMetadata,
  encryptRouteBody,
  decryptRouteBody,
  encryptCanvasMetadata,
  decryptCanvasMetadata,
  encryptCanvasBody,
  decryptCanvasBody,
} from '@/lib/identity/library-crypto'
import {
  openCollectionShare,
  sealCollectionShare,
} from '@/lib/identity/collection-share'
import {
  buildWrappedKmSlot,
  type WrappedKmSlot,
} from '@/lib/identity/passkey-prf'
import { extractPrfOutputFromAssertion } from '@/lib/identity/passkey-prf-support'
import { storeSeed } from '@/lib/identity/key-storage'
import { keepPinsAcrossSeedChange } from '@/lib/identity/key-pinning'

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
  scheme: 'server-key' | 'user-e2ee'
  metadataEncrypted: string | null
  metadataKeyVersion: number
}

interface ServerSealedRecord {
  id: string
  metadataEncrypted?: string | null
  bodyEncrypted?: string | null
}

interface ServerOutgoingShare {
  id: string
  recipientHandle: string
  recipientUserId: string | null
  resourceType: string
  resourceId: string
  status: string
}

interface ServerIncomingShare {
  id: string
  senderHandle: string
  resourceType: string
  encryptedData: string
  nonce: string
  status: string
}

interface PreparedEnvelope {
  id: string
  encryptedData: string
  nonce: string
}

const LIVE_SHARE_STATUSES = new Set(['pending', 'accepted'])

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
  | { kind: 'confirming-recovery-key' }
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

/** Something can't be carried over to the new keys, so nothing was changed. */
export class RotationAbortedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RotationAbortedError'
  }
}

export class RotationCancelledError extends Error {
  constructor() {
    super('Rotation cancelled. Your keys were not changed.')
    this.name = 'RotationCancelledError'
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
  /** A friend's cached X25519 public key, for re-sealing share envelopes. */
  friendEncryptionKey: (handle: string) => string | null | undefined
  /** Show the new recovery key; resolves true once the user has saved it. */
  confirmRecoveryKey: (recoveryKey: string) => Promise<boolean>
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
  metadataEncrypted?: string
  points?: Array<{ id: string; encryptedData: string }>
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
    if (!c.metadataEncrypted && c.scheme !== 'user-e2ee') continue
    progress({
      kind: 'reencrypt-collection',
      collectionId: c.id,
      index: i + 1,
      total: serverCollections.length,
    })
    const rebuilt: PreparedCollection = { id: c.id }
    if (c.metadataEncrypted) {
      rebuilt.metadataEncrypted = rebuildCollectionMetadata({
        userId: params.userId,
        collectionId: c.id,
        oldEnvelope: c.metadataEncrypted,
        keyVersion: c.metadataKeyVersion,
        oldSeed: params.oldSeed,
        newSeed,
      })
    }
    if (c.scheme === 'user-e2ee') {
      rebuilt.points = await rebuildCollectionPoints({
        userId: params.userId,
        collectionId: c.id,
        keyVersion: c.metadataKeyVersion,
        oldSeed: params.oldSeed,
        newSeed,
      })
    }
    preparedCollections.push(rebuilt)
  }

  // 3. Routes and canvases.
  const { userId, oldSeed } = params
  const routesResp = await api.get<ServerSealedRecord[]>('/library/routes')
  const preparedRoutes = (routesResp.data ?? []).flatMap(r =>
    rebuildSealedRecord(r, 'route', {
      metadata: envelope =>
        encryptRouteMetadata({
          seed: newSeed,
          userId,
          routeId: r.id,
          metadata: decryptRouteMetadata({ envelope, seed: oldSeed, userId, routeId: r.id }),
        }),
      body: envelope =>
        encryptRouteBody({
          seed: newSeed,
          userId,
          routeId: r.id,
          body: decryptRouteBody({ envelope, seed: oldSeed, userId, routeId: r.id }),
        }),
    }),
  )
  const canvasesResp = await api.get<ServerSealedRecord[]>('/library/canvases')
  const preparedCanvases = (canvasesResp.data ?? []).flatMap(c =>
    rebuildSealedRecord(c, 'canvas', {
      metadata: envelope =>
        encryptCanvasMetadata({
          seed: newSeed,
          userId,
          canvasId: c.id,
          metadata: decryptCanvasMetadata({ envelope, seed: oldSeed, userId, canvasId: c.id }),
        }),
      body: envelope =>
        encryptCanvasBody({
          seed: newSeed,
          userId,
          canvasId: c.id,
          body: decryptCanvasBody({ envelope, seed: oldSeed, userId, canvasId: c.id }),
        }),
    }),
  )

  // 4. Share envelopes.
  const oldKeys = deriveAllKeys(params.oldSeed)
  const preparedShares = await resealOutgoingShares({
    privateCollections: serverCollections.filter(c => c.scheme === 'user-e2ee'),
    newSeed,
    newPrivateKey: newKeys.encryption.privateKey,
    friendEncryptionKey: params.friendEncryptionKey,
  })
  const preparedIncomingShares = await resealIncomingShares({
    oldPrivateKey: oldKeys.encryption.privateKey,
    newPrivateKey: newKeys.encryption.privateKey,
    friendEncryptionKey: params.friendEncryptionKey,
  })

  // 5. Re-seal every slot. One tap per slot, scoped to the slot's own
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

  // 6. The old recovery key stops working, so the new one must be saved.
  progress({ kind: 'confirming-recovery-key' })
  if (!(await params.confirmRecoveryKey(exportRecoveryKey(newSeed)))) {
    throw new RotationCancelledError()
  }

  // 7. Atomic commit. Either everything lands or nothing does.
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
        routes: preparedRoutes,
        canvases: preparedCanvases,
        shares: preparedShares,
        incomingShares: preparedIncomingShares,
        slots: preparedSlots,
        recoveryKeyConfirmed: true,
      },
    )
    newKmVersion = response.data.kmVersion
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status === 409) throw new RotationConflictError()
    const message = (err as { response?: { data?: { message?: string } } })
      ?.response?.data?.message
    if (status === 422 && message) throw new RotationAbortedError(message)
    throw err
  }

  // 8. Persist the new seed locally. If this fails after a successful
  //    commit the server is authoritative; user can recover via a
  //    passkey unlock on this device (which unwraps from a just-
  //    re-sealed slot).
  progress({ kind: 'storing-seed' })
  await keepPinsAcrossSeedChange(() => storeSeed(newSeed))

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

function unreadable(what: string): RotationAbortedError {
  return new RotationAbortedError(
    `Couldn't read ${what} with your current keys, so nothing was changed. Sign out and back in on this device, then try again.`,
  )
}

function rebuildCollectionMetadata(params: {
  userId: string
  collectionId: string
  oldEnvelope: string
  keyVersion: number
  oldSeed: Uint8Array
  newSeed: Uint8Array
}): string {
  let metadata
  try {
    metadata = decryptCollectionMetadata({
      envelope: params.oldEnvelope,
      source: { seed: params.oldSeed },
      userId: params.userId,
      collectionId: params.collectionId,
      keyVersion: params.keyVersion,
    })
  } catch {
    throw unreadable('a collection')
  }
  return encryptCollectionMetadata({
    metadata,
    source: { seed: params.newSeed },
    userId: params.userId,
    collectionId: params.collectionId,
    keyVersion: params.keyVersion,
  })
}

/** A private collection's points move to the new seed's key, keeping their ids. */
async function rebuildCollectionPoints(params: {
  userId: string
  collectionId: string
  keyVersion: number
  oldSeed: Uint8Array
  newSeed: Uint8Array
}): Promise<Array<{ id: string; encryptedData: string }>> {
  const { data } = await api.get<{ points: Array<{ id: string; encryptedData: string }> }>(
    `/library/collections/${params.collectionId}/encrypted-points`,
  )
  return (data.points ?? []).map(row => {
    let decrypted
    try {
      decrypted = decryptCollectionPoint({
        point: row,
        source: { seed: params.oldSeed },
        ownerUserId: params.userId,
        collectionId: params.collectionId,
        keyVersion: params.keyVersion,
      })
    } catch {
      throw unreadable('a saved place')
    }
    const { id, ...point } = decrypted
    return {
      id,
      encryptedData: encryptCollectionPoint({
        point,
        pointId: id,
        source: { seed: params.newSeed },
        ownerUserId: params.userId,
        collectionId: params.collectionId,
        keyVersion: params.keyVersion,
      }),
    }
  })
}

/** Re-encrypt a route's or canvas's sealed fields; empty when it has none. */
function rebuildSealedRecord(
  record: ServerSealedRecord,
  label: string,
  reencrypt: Record<'metadata' | 'body', (envelope: string) => string>,
): Array<{ id: string; metadataEncrypted?: string; bodyEncrypted?: string }> {
  if (!record.metadataEncrypted && !record.bodyEncrypted) return []
  try {
    return [
      {
        id: record.id,
        ...(record.metadataEncrypted && {
          metadataEncrypted: reencrypt.metadata(record.metadataEncrypted),
        }),
        ...(record.bodyEncrypted && {
          bodyEncrypted: reencrypt.body(record.bodyEncrypted),
        }),
      },
    ]
  } catch {
    throw unreadable(`a ${label}`)
  }
}

/** Every live share of a private collection, re-sealed with the new owner key. */
async function resealOutgoingShares(params: {
  privateCollections: ServerCollection[]
  newSeed: Uint8Array
  newPrivateKey: Uint8Array
  friendEncryptionKey: RotateParams['friendEncryptionKey']
}): Promise<PreparedEnvelope[]> {
  if (!params.privateCollections.length) return []
  const byId = new Map(params.privateCollections.map(c => [c.id, c]))
  const { data } = await api.get<{ shares: ServerOutgoingShare[] }>('/sharing/outgoing')
  const live = (data.shares ?? []).filter(
    s =>
      s.resourceType === 'collection' &&
      byId.has(s.resourceId) &&
      LIVE_SHARE_STATUSES.has(s.status),
  )
  const remote = live.filter(s => !s.recipientUserId).map(s => s.recipientHandle)
  if (remote.length) {
    throw new RotationAbortedError(
      `Stop sharing your private collections with ${remote.join(', ')} first. They're on another server, so new keys can't reach them.`,
    )
  }
  return live.map(s => {
    const recipientKey = params.friendEncryptionKey(s.recipientHandle)
    if (!recipientKey) {
      throw new RotationAbortedError(
        `Couldn't find ${s.recipientHandle}'s keys, so nothing was changed. Open your friends list to refresh them, then try again.`,
      )
    }
    const collection = byId.get(s.resourceId)!
    const keyVersion = collection.metadataKeyVersion ?? 1
    const sealed = sealCollectionShare({
      share: {
        collectionId: collection.id,
        scheme: 'user-e2ee',
        key: deriveCollectionKey(params.newSeed, collection.id, keyVersion),
        keyVersion,
      },
      ownerPrivateKey: params.newPrivateKey,
      recipientPublicKey: importPublicKey(recipientKey),
    })
    return { id: s.id, ...sealed }
  })
}

/**
 * Collections shared with this user, re-sealed for the new key. A static-DH
 * envelope opens with either party's key, so the recipient can re-seal it.
 * Envelopes that won't open are left for the server to judge: it refuses
 * only when one guards a private collection.
 */
async function resealIncomingShares(params: {
  oldPrivateKey: Uint8Array
  newPrivateKey: Uint8Array
  friendEncryptionKey: RotateParams['friendEncryptionKey']
}): Promise<PreparedEnvelope[]> {
  const { data } = await api.get<{ shares: ServerIncomingShare[] }>('/sharing/incoming')
  return (data.shares ?? []).flatMap(s => {
    if (s.resourceType !== 'collection' || !LIVE_SHARE_STATUSES.has(s.status)) return []
    const senderKey = params.friendEncryptionKey(s.senderHandle)
    if (!senderKey) return []
    const senderPublicKey = importPublicKey(senderKey)
    try {
      const share = openCollectionShare({
        envelope: s,
        recipientPrivateKey: params.oldPrivateKey,
        senderPublicKey,
      })
      return [
        {
          id: s.id,
          ...sealCollectionShare({
            share,
            ownerPrivateKey: params.newPrivateKey,
            recipientPublicKey: senderPublicKey,
          }),
        },
      ]
    } catch {
      return []
    }
  })
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
    const res = await api.get<ServerBlobValue>(`/me/blobs/${encodedType}`)
    // 204/empty (or legacy 404 below) — blob disappeared between list + fetch.
    if (res.status === 204 || !res.data?.encryptedBlob) return null
    envelope = res.data
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
    throw unreadable(`your ${params.blobType} data`)
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
