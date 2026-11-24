/**
 * Integration-style tests for the rotation orchestrator.
 *
 * We stub only the HTTP client, the local seed store, and the per-slot
 * assertion callback. All the actual crypto (v2 envelope, HKDF, per-
 * collection keys, slot signing) runs for real, so these tests catch
 * regressions like "we sent the wrong AAD" or "we no-oped a phase that
 * was supposed to rebuild data."
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => {
  const state = {
    storedSeed: null as Uint8Array | null,
    getHandlers: new Map<string, (body?: unknown) => unknown>(),
    postHandlers: new Map<
      string,
      (body?: unknown) => unknown | Promise<unknown>
    >(),
  }
  return {
    state,
    storeSeedSpy: vi.fn(async (seed: Uint8Array) => {
      state.storedSeed = seed
    }),
    apiGetSpy: vi.fn(async (url: string) => {
      const handler = state.getHandlers.get(url)
      if (!handler) {
        const err = new Error(`Unexpected GET ${url}`) as Error & {
          response?: { status: number }
        }
        err.response = { status: 500 }
        throw err
      }
      return handler()
    }),
    apiPostSpy: vi.fn(async (url: string, body?: unknown) => {
      const handler = state.postHandlers.get(url)
      if (!handler) {
        const err = new Error(`Unexpected POST ${url}`) as Error & {
          response?: { status: number }
        }
        err.response = { status: 500 }
        throw err
      }
      return handler(body)
    }),
  }
})

vi.mock('@/lib/identity/key-storage', () => ({
  storeSeed: (seed: Uint8Array) => hoisted.storeSeedSpy(seed),
  getSeed: async () => hoisted.state.storedSeed,
  hasIdentity: async () => hoisted.state.storedSeed !== null,
  clearIdentity: async () => {
    hoisted.state.storedSeed = null
  },
}))

vi.mock('@/lib/api', () => ({
  api: {
    get: hoisted.apiGetSpy,
    post: hoisted.apiPostSpy,
    put: vi.fn(),
    delete: vi.fn(),
  },
  isTauri: false,
  getIsTauri: async () => false,
}))

import {
  generateSeed,
  deriveAllKeys,
  derivePersonalKey,
  bytesToBase64,
  exportPublicKey,
  type DerivedKeys,
} from '@/lib/identity/federation-crypto'
import {
  encryptEnvelopeString,
  type AAD,
} from '@/lib/identity/crypto-envelope'
import {
  decryptCollectionPoint,
  encryptCollectionMetadata,
  encryptCollectionPoint,
} from '@/lib/identity/library-crypto'
import {
  rotateMasterKey,
  RotationAbortedError,
  RotationCancelledError,
  RotationConflictError,
} from './km-rotation'
import {
  openCollectionShare,
  sealCollectionShare,
} from '@/lib/identity/collection-share'
import {
  decryptCanvasBody,
  decryptRouteMetadata,
  encryptCanvasBody,
  encryptRouteMetadata,
} from '@/lib/identity/library-crypto'
import { deriveCollectionKey, importPublicKey } from '@/lib/identity/federation-crypto'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const { apiGetSpy, apiPostSpy, storeSeedSpy, state } = hoisted
const getHandlers = state.getHandlers
const postHandlers = state.postHandlers

function toBase64Url(bytes: Uint8Array): string {
  let b = ''
  for (let i = 0; i < bytes.length; i++) b += String.fromCharCode(bytes[i])
  return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function personalBlobAad(userId: string, blobType: string): AAD {
  return {
    userId,
    recordType: 'personal-blob',
    recordId: blobType,
    keyContext: 'parchment-personal-v1',
  }
}

function makeAssertionWithPrf(prfOutput: Uint8Array) {
  return {
    clientExtensionResults: {
      prf: { results: { first: toBase64Url(prfOutput) } },
    },
  }
}

const hooks = {
  friendEncryptionKey: (_handle: string): string | null => null,
  confirmRecoveryKey: async (_key: string) => true,
}

beforeEach(() => {
  state.storedSeed = null
  getHandlers.clear()
  postHandlers.clear()
  getHandlers.set('/library/routes', () => ({ data: [] }))
  getHandlers.set('/library/canvases', () => ({ data: [] }))
  getHandlers.set('/sharing/outgoing', () => ({ data: { shares: [] } }))
  getHandlers.set('/sharing/incoming', () => ({ data: { shares: [] } }))
  apiGetSpy.mockClear()
  apiPostSpy.mockClear()
  storeSeedSpy.mockClear()
})

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('rotateMasterKey — happy path', () => {
  const userId = 'user-rot'

  test('rebuilds blobs + collections, reseals slots, atomic commit, stores new seed', async () => {
    const oldSeed = generateSeed()
    const newSeedRef = { current: null as Uint8Array | null }
    state.storedSeed = oldSeed

    // Server state under the OLD seed.
    const oldPersonalKey = derivePersonalKey(oldSeed)
    const oldBlobPlaintext = JSON.stringify({ entries: ['a', 'b'] })
    const oldBlobEnvelope = encryptEnvelopeString({
      plaintext: oldBlobPlaintext,
      key: oldPersonalKey,
      aad: personalBlobAad(userId, 'search-history'),
    })
    const collectionId = 'c1'
    const oldCollectionMeta = encryptCollectionMetadata({
      metadata: { name: 'Favorites', icon: 'star', iconColor: '#fff' },
      source: { seed: oldSeed },
      userId,
      collectionId,
    })

    // Slot under the OLD seed: just need the credentialId for lookup;
    // we don't decrypt it in this test.
    const slotCredentialId = 'cred-1'
    getHandlers.set('/me/blobs', () => ({
      data: {
        blobs: [{ blobType: 'search-history', kmVersion: 1 }],
      },
    }))
    getHandlers.set('/me/blobs/search-history', () => ({
      data: {
        encryptedBlob: oldBlobEnvelope,
        nonce: '',
        kmVersion: 1,
        updatedAt: 'now',
      },
    }))
    getHandlers.set('/library/collections', () => ({
      data: [{ id: collectionId, metadataEncrypted: oldCollectionMeta }],
    }))
    getHandlers.set('/users/me/wrapped-keys', () => ({
      data: {
        slots: [
          {
            credentialId: slotCredentialId,
            wrappedKm: 'ignored',
            wrapAlgo: 'aes-256-gcm-prf-v1',
            slotSignature: 'ignored',
          },
        ],
      },
    }))

    // Capture the commit body so we can assert against it.
    let commitBody: unknown
    postHandlers.set('/users/me/km-version/commit', (body) => {
      commitBody = body
      return { data: { kmVersion: 2 } }
    })

    const prfOutput = new Uint8Array(32).fill(0x42)
    const assertPasskeyForSlot = vi.fn(async (cred: string) => {
      // Must receive the slot's credentialId so the test can fail loud
      // if the orchestrator ever forgets to scope.
      expect(cred).toBe(slotCredentialId)
      return makeAssertionWithPrf(prfOutput)
    })

    const result = await rotateMasterKey({
      ...hooks,
      userId,
      oldSeed,
      currentKmVersion: 1,
      assertPasskeyForSlot,
    })

    newSeedRef.current = result.newSeed
    expect(result.newKmVersion).toBe(2)
    expect(result.slotResults).toEqual([
      { credentialId: slotCredentialId, ok: true },
    ])
    expect(storeSeedSpy).toHaveBeenCalledOnce()
    expect(storeSeedSpy).toHaveBeenCalledWith(result.newSeed)
    expect(assertPasskeyForSlot).toHaveBeenCalledOnce()

    // One and only one server-mutating call — the atomic commit.
    expect(apiPostSpy).toHaveBeenCalledOnce()
    expect(apiPostSpy).toHaveBeenCalledWith(
      '/users/me/km-version/commit',
      expect.any(Object),
    )

    const body = commitBody as {
      expectedCurrent: number
      signingKey: string
      encryptionKey: string
      blobs: Array<{ blobType: string; encryptedBlob: string }>
      collections: Array<{ id: string; metadataEncrypted: string }>
      slots: Array<{ credentialId: string }>
    }

    // Shape of the batched commit.
    expect(body.expectedCurrent).toBe(1)
    expect(body.signingKey).toBe(
      exportPublicKey(result.newKeys.signing.publicKey),
    )
    expect(body.encryptionKey).toBe(
      exportPublicKey(result.newKeys.encryption.publicKey),
    )
    expect(body.blobs).toHaveLength(1)
    expect(body.blobs[0].blobType).toBe('search-history')
    expect(body.collections).toHaveLength(1)
    expect(body.collections[0].id).toBe(collectionId)
    expect(body.slots).toHaveLength(1)
    expect(body.slots[0].credentialId).toBe(slotCredentialId)

    // Most important invariant: the NEW envelopes must NOT match the
    // OLD ones (otherwise we're uploading garbage or no-oping a phase).
    expect(body.blobs[0].encryptedBlob).not.toBe(oldBlobEnvelope)
    expect(body.collections[0].metadataEncrypted).not.toBe(oldCollectionMeta)
  })
})

describe('rotateMasterKey — private collections', () => {
  const userId = 'user-rot'

  test('re-seals each point so the places open under the new seed', async () => {
    const oldSeed = generateSeed()
    state.storedSeed = oldSeed
    const collectionId = 'c-private'
    const place = {
      externalIds: { osm: 'node/1' },
      name: 'Coffee Land',
      address: null,
      lat: 40.67,
      lng: -73.95,
      icon: 'cafe',
      iconPack: 'maki' as const,
      iconColor: 'rose',
      frequentType: null,
    }
    const oldPoint = encryptCollectionPoint({
      point: place,
      pointId: 'pt-1',
      source: { seed: oldSeed },
      ownerUserId: userId,
      collectionId,
      keyVersion: 2,
    })

    getHandlers.set('/me/blobs', () => ({ data: { blobs: [] } }))
    getHandlers.set('/library/collections', () => ({
      data: [
        { id: collectionId, scheme: 'user-e2ee', metadataEncrypted: null, metadataKeyVersion: 2 },
      ],
    }))
    getHandlers.set(`/library/collections/${collectionId}/encrypted-points`, () => ({
      data: { points: [{ id: 'pt-1', encryptedData: oldPoint }] },
    }))
    getHandlers.set('/users/me/wrapped-keys', () => ({ data: { slots: [] } }))
    let commitBody: any
    postHandlers.set('/users/me/km-version/commit', (body) => {
      commitBody = body
      return { data: { kmVersion: 2 } }
    })

    const result = await rotateMasterKey({
      ...hooks,
      userId,
      oldSeed,
      currentKmVersion: 1,
      assertPasskeyForSlot: vi.fn(),
    })

    const [resealed] = commitBody.collections[0].points
    expect(resealed.id).toBe('pt-1')
    expect(
      decryptCollectionPoint({
        point: resealed,
        source: { seed: result.newSeed },
        ownerUserId: userId,
        collectionId,
        keyVersion: 2,
      }).name,
    ).toBe('Coffee Land')
  })
})

// ---------------------------------------------------------------------------
// Conflict handling
// ---------------------------------------------------------------------------

describe('rotateMasterKey — commit conflict', () => {
  test('409 from commit endpoint throws RotationConflictError and does NOT store the new seed', async () => {
    const oldSeed = generateSeed()
    state.storedSeed = oldSeed

    getHandlers.set('/me/blobs', () => ({ data: { blobs: [] } }))
    getHandlers.set('/library/collections', () => ({ data: [] }))
    getHandlers.set('/users/me/wrapped-keys', () => ({ data: { slots: [] } }))
    postHandlers.set('/users/me/km-version/commit', () => {
      const err = new Error('kmVersion mismatch') as Error & {
        response?: { status: number }
      }
      err.response = { status: 409 }
      throw err
    })

    await expect(
      rotateMasterKey({
        ...hooks,
        userId: 'u',
        oldSeed,
        currentKmVersion: 1,
        assertPasskeyForSlot: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(RotationConflictError)

    expect(storeSeedSpy).not.toHaveBeenCalled()
    expect(state.storedSeed).toBe(oldSeed)
  })

  test('non-409 errors propagate unchanged', async () => {
    const oldSeed = generateSeed()
    state.storedSeed = oldSeed

    getHandlers.set('/me/blobs', () => ({ data: { blobs: [] } }))
    getHandlers.set('/library/collections', () => ({ data: [] }))
    getHandlers.set('/users/me/wrapped-keys', () => ({ data: { slots: [] } }))
    postHandlers.set('/users/me/km-version/commit', () => {
      const err = new Error('Internal') as Error & {
        response?: { status: number }
      }
      err.response = { status: 500 }
      throw err
    })

    await expect(
      rotateMasterKey({
        ...hooks,
        userId: 'u',
        oldSeed,
        currentKmVersion: 1,
        assertPasskeyForSlot: vi.fn(),
      }),
    ).rejects.toThrow('Internal')

    expect(storeSeedSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Slot reseal failure modes
// ---------------------------------------------------------------------------

describe('rotateMasterKey — slot reseal failures', () => {
  const userId = 'user-slot-fail'
  const slotCredA = 'cred-a'
  const slotCredB = 'cred-b'

  beforeEach(() => {
    getHandlers.set('/me/blobs', () => ({ data: { blobs: [] } }))
    getHandlers.set('/library/collections', () => ({ data: [] }))
    postHandlers.set('/users/me/km-version/commit', () => ({
      data: { kmVersion: 2 },
    }))
  })

  test('PRF-missing slot is reported failed but does NOT abort rotation', async () => {
    const oldSeed = generateSeed()
    state.storedSeed = oldSeed
    getHandlers.set('/users/me/wrapped-keys', () => ({
      data: {
        slots: [
          {
            credentialId: slotCredA,
            wrappedKm: 'x',
            wrapAlgo: 'x',
            slotSignature: 'x',
          },
          {
            credentialId: slotCredB,
            wrappedKm: 'x',
            wrapAlgo: 'x',
            slotSignature: 'x',
          },
        ],
      },
    }))

    // First slot returns PRF; second returns assertion without PRF.
    const prfOutput = new Uint8Array(32).fill(0x11)
    const assertPasskeyForSlot = vi.fn(async (cred: string) => {
      if (cred === slotCredA) return makeAssertionWithPrf(prfOutput)
      return { clientExtensionResults: { prf: { results: {} } } }
    })

    let committedBody: { slots: Array<{ credentialId: string }> } | undefined
    postHandlers.set('/users/me/km-version/commit', (body) => {
      committedBody = body as { slots: Array<{ credentialId: string }> }
      return { data: { kmVersion: 2 } }
    })

    const result = await rotateMasterKey({
      ...hooks,
      userId,
      oldSeed,
      currentKmVersion: 1,
      assertPasskeyForSlot,
    })

    expect(result.slotResults).toEqual([
      { credentialId: slotCredA, ok: true },
      { credentialId: slotCredB, ok: false, reason: 'no-prf' },
    ])
    expect(committedBody?.slots).toHaveLength(1)
    expect(committedBody!.slots[0].credentialId).toBe(slotCredA)
    expect(storeSeedSpy).toHaveBeenCalledOnce()
  })

  test("cancelled slot ceremony marks the slot 'no-prf' and continues with the rest", async () => {
    const oldSeed = generateSeed()
    state.storedSeed = oldSeed
    getHandlers.set('/users/me/wrapped-keys', () => ({
      data: {
        slots: [
          {
            credentialId: slotCredA,
            wrappedKm: 'x',
            wrapAlgo: 'x',
            slotSignature: 'x',
          },
        ],
      },
    }))
    const assertPasskeyForSlot = vi.fn(async () => {
      const err = new Error('cancelled')
      err.name = 'NotAllowedError'
      throw err
    })
    const result = await rotateMasterKey({
      ...hooks,
      userId,
      oldSeed,
      currentKmVersion: 1,
      assertPasskeyForSlot,
    })
    expect(result.slotResults).toEqual([
      { credentialId: slotCredA, ok: false, reason: 'no-prf' },
    ])
    expect(storeSeedSpy).toHaveBeenCalledOnce() // rotation still commits
  })
})

// ---------------------------------------------------------------------------
// Data-rebuild skip cases
// ---------------------------------------------------------------------------

describe('rotateMasterKey — undecryptable or skipped data', () => {
  const userId = 'user-skip'

  beforeEach(() => {
    getHandlers.set('/users/me/wrapped-keys', () => ({ data: { slots: [] } }))
  })

  test('a blob that will not decrypt aborts before anything is committed', async () => {
    const oldSeed = generateSeed()
    state.storedSeed = oldSeed

    const wrongEnvelope = encryptEnvelopeString({
      plaintext: '"hello"',
      key: derivePersonalKey(generateSeed()),
      aad: personalBlobAad(userId, 'search-history'),
    })
    getHandlers.set('/me/blobs', () => ({
      data: { blobs: [{ blobType: 'search-history', kmVersion: 1 }] },
    }))
    getHandlers.set('/me/blobs/search-history', () => ({
      data: {
        encryptedBlob: wrongEnvelope,
        nonce: '',
        kmVersion: 1,
        updatedAt: 'now',
      },
    }))
    getHandlers.set('/library/collections', () => ({ data: [] }))

    await expect(
      rotateMasterKey({
        ...hooks,
        userId,
        oldSeed,
        currentKmVersion: 1,
        assertPasskeyForSlot: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(RotationAbortedError)
    expect(apiPostSpy).not.toHaveBeenCalled()
    expect(storeSeedSpy).not.toHaveBeenCalled()
  })

  test('collection without an envelope is silently skipped', async () => {
    const oldSeed = generateSeed()
    state.storedSeed = oldSeed
    getHandlers.set('/me/blobs', () => ({ data: { blobs: [] } }))
    getHandlers.set('/library/collections', () => ({
      data: [
        { id: 'c1', metadataEncrypted: null },
        { id: 'c2', metadataEncrypted: null },
      ],
    }))

    let body: { collections: unknown[] } | undefined
    postHandlers.set('/users/me/km-version/commit', (b) => {
      body = b as { collections: unknown[] }
      return { data: { kmVersion: 2 } }
    })

    await rotateMasterKey({
      ...hooks,
      userId,
      oldSeed,
      currentKmVersion: 1,
      assertPasskeyForSlot: vi.fn(),
    })

    expect(body?.collections).toEqual([])
  })

  test('blob GET returning 404 between list + fetch is skipped', async () => {
    const oldSeed = generateSeed()
    state.storedSeed = oldSeed
    getHandlers.set('/me/blobs', () => ({
      data: { blobs: [{ blobType: 'gone', kmVersion: 1 }] },
    }))
    getHandlers.set('/me/blobs/gone', () => {
      const err = new Error('Not found') as Error & {
        response?: { status: number }
      }
      err.response = { status: 404 }
      throw err
    })
    getHandlers.set('/library/collections', () => ({ data: [] }))
    let body: { blobs: unknown[] } | undefined
    postHandlers.set('/users/me/km-version/commit', (b) => {
      body = b as { blobs: unknown[] }
      return { data: { kmVersion: 2 } }
    })

    await rotateMasterKey({
      ...hooks,
      userId,
      oldSeed,
      currentKmVersion: 1,
      assertPasskeyForSlot: vi.fn(),
    })

    expect(body?.blobs).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Routes, canvases and shares
// ---------------------------------------------------------------------------

describe('rotateMasterKey — routes, canvases and shares', () => {
  const userId = 'owner'

  beforeEach(() => {
    getHandlers.set('/me/blobs', () => ({ data: { blobs: [] } }))
    getHandlers.set('/library/collections', () => ({ data: [] }))
    getHandlers.set('/users/me/wrapped-keys', () => ({ data: { slots: [] } }))
  })

  function captureCommit() {
    const captured: { body?: any } = {}
    postHandlers.set('/users/me/km-version/commit', (body) => {
      captured.body = body
      return { data: { kmVersion: 2 } }
    })
    return captured
  }

  test('re-encrypts routes and canvases under the new seed', async () => {
    const oldSeed = generateSeed()
    getHandlers.set('/library/routes', () => ({
      data: [
        {
          id: 'r1',
          metadataEncrypted: encryptRouteMetadata({
            metadata: { name: 'Loop' },
            seed: oldSeed,
            userId,
            routeId: 'r1',
          }),
          bodyEncrypted: null,
        },
        { id: 'r2', metadataEncrypted: null, bodyEncrypted: null },
      ],
    }))
    getHandlers.set('/library/canvases', () => ({
      data: [
        {
          id: 'cv1',
          metadataEncrypted: null,
          bodyEncrypted: encryptCanvasBody({
            body: { layers: [1] },
            seed: oldSeed,
            userId,
            canvasId: 'cv1',
          }),
        },
      ],
    }))
    const commit = captureCommit()

    const result = await rotateMasterKey({
      ...hooks,
      userId,
      oldSeed,
      currentKmVersion: 1,
      assertPasskeyForSlot: vi.fn(),
    })

    expect(commit.body.routes).toHaveLength(1)
    expect(
      decryptRouteMetadata({
        envelope: commit.body.routes[0].metadataEncrypted,
        seed: result.newSeed,
        userId,
        routeId: 'r1',
      }).name,
    ).toBe('Loop')
    expect(
      decryptCanvasBody({
        envelope: commit.body.canvases[0].bodyEncrypted,
        seed: result.newSeed,
        userId,
        canvasId: 'cv1',
      }),
    ).toEqual({ layers: [1] })
  })

  test('re-seals a private collection share so the recipient gets the new key', async () => {
    const oldSeed = generateSeed()
    const friend = deriveAllKeys(generateSeed())
    const friendKey = exportPublicKey(friend.encryption.publicKey)
    getHandlers.set('/library/collections', () => ({
      data: [
        { id: 'c1', scheme: 'user-e2ee', metadataEncrypted: null, metadataKeyVersion: 3 },
      ],
    }))
    getHandlers.set('/library/collections/c1/encrypted-points', () => ({
      data: { points: [] },
    }))
    getHandlers.set('/sharing/outgoing', () => ({
      data: {
        shares: [
          {
            id: 's1',
            recipientHandle: 'friend@here',
            recipientUserId: 'friend',
            resourceType: 'collection',
            resourceId: 'c1',
            status: 'accepted',
          },
          {
            id: 's-old',
            recipientHandle: 'gone@here',
            recipientUserId: 'gone',
            resourceType: 'collection',
            resourceId: 'c1',
            status: 'revoked',
          },
        ],
      },
    }))
    const commit = captureCommit()

    const result = await rotateMasterKey({
      ...hooks,
      friendEncryptionKey: (h) => (h === 'friend@here' ? friendKey : null),
      userId,
      oldSeed,
      currentKmVersion: 1,
      assertPasskeyForSlot: vi.fn(),
    })

    expect(commit.body.shares.map((s: any) => s.id)).toEqual(['s1'])
    const opened = openCollectionShare({
      envelope: commit.body.shares[0],
      recipientPrivateKey: friend.encryption.privateKey,
      senderPublicKey: result.newKeys.encryption.publicKey,
    })
    expect(opened.key).toEqual(deriveCollectionKey(result.newSeed, 'c1', 3))
    expect(opened.keyVersion).toBe(3)
  })

  test('refuses while a private collection is shared with another server', async () => {
    getHandlers.set('/library/collections', () => ({
      data: [
        { id: 'c1', scheme: 'user-e2ee', metadataEncrypted: null, metadataKeyVersion: 1 },
      ],
    }))
    getHandlers.set('/library/collections/c1/encrypted-points', () => ({
      data: { points: [] },
    }))
    getHandlers.set('/sharing/outgoing', () => ({
      data: {
        shares: [
          {
            id: 's1',
            recipientHandle: 'bob@elsewhere.test',
            recipientUserId: null,
            resourceType: 'collection',
            resourceId: 'c1',
            status: 'accepted',
          },
        ],
      },
    }))

    await expect(
      rotateMasterKey({
        ...hooks,
        userId,
        oldSeed: generateSeed(),
        currentKmVersion: 1,
        assertPasskeyForSlot: vi.fn(),
      }),
    ).rejects.toThrow('bob@elsewhere.test')
    expect(apiPostSpy).not.toHaveBeenCalled()
  })

  test('re-seals a collection shared with this user under its new key', async () => {
    const oldSeed = generateSeed()
    const oldKeys = deriveAllKeys(oldSeed)
    const sender = deriveAllKeys(generateSeed())
    const collectionKey = new Uint8Array(32).fill(7)
    const envelope = sealCollectionShare({
      share: { collectionId: 'theirs', scheme: 'user-e2ee', key: collectionKey, keyVersion: 1 },
      ownerPrivateKey: sender.encryption.privateKey,
      recipientPublicKey: oldKeys.encryption.publicKey,
    })
    getHandlers.set('/sharing/incoming', () => ({
      data: {
        shares: [
          {
            id: 'in-1',
            senderHandle: 'sender@here',
            resourceType: 'collection',
            status: 'accepted',
            ...envelope,
          },
        ],
      },
    }))
    const commit = captureCommit()

    const result = await rotateMasterKey({
      ...hooks,
      friendEncryptionKey: () => exportPublicKey(sender.encryption.publicKey),
      userId,
      oldSeed,
      currentKmVersion: 1,
      assertPasskeyForSlot: vi.fn(),
    })

    const resealed = commit.body.incomingShares[0]
    expect(resealed.id).toBe('in-1')
    expect(
      openCollectionShare({
        envelope: resealed,
        recipientPrivateKey: result.newKeys.encryption.privateKey,
        senderPublicKey: importPublicKey(exportPublicKey(sender.encryption.publicKey)),
      }).key,
    ).toEqual(collectionKey)
  })
})

describe('rotateMasterKey — recovery key', () => {
  beforeEach(() => {
    getHandlers.set('/me/blobs', () => ({ data: { blobs: [] } }))
    getHandlers.set('/library/collections', () => ({ data: [] }))
    getHandlers.set('/users/me/wrapped-keys', () => ({ data: { slots: [] } }))
  })

  test('shows the new recovery key and commits only once it is saved', async () => {
    let shown: string | undefined
    let body: any
    postHandlers.set('/users/me/km-version/commit', (b) => {
      body = b
      return { data: { kmVersion: 2 } }
    })

    const result = await rotateMasterKey({
      ...hooks,
      confirmRecoveryKey: async (key) => {
        shown = key
        return true
      },
      userId: 'u',
      oldSeed: generateSeed(),
      currentKmVersion: 1,
      assertPasskeyForSlot: vi.fn(),
    })

    expect(shown).toBe(bytesToBase64(result.newSeed))
    expect(body.recoveryKeyConfirmed).toBe(true)
  })

  test('backing out of the recovery key leaves the keys unchanged', async () => {
    await expect(
      rotateMasterKey({
        ...hooks,
        confirmRecoveryKey: async () => false,
        userId: 'u',
        oldSeed: generateSeed(),
        currentKmVersion: 1,
        assertPasskeyForSlot: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(RotationCancelledError)
    expect(apiPostSpy).not.toHaveBeenCalled()
    expect(storeSeedSpy).not.toHaveBeenCalled()
  })

  test('surfaces the server refusing an incomplete rotation', async () => {
    postHandlers.set('/users/me/km-version/commit', () => {
      const err = new Error('422') as Error & { response?: unknown }
      err.response = { status: 422, data: { message: 'Rotation is missing re-encrypted data: route r9.' } }
      throw err
    })

    await expect(
      rotateMasterKey({
        ...hooks,
        userId: 'u',
        oldSeed: generateSeed(),
        currentKmVersion: 1,
        assertPasskeyForSlot: vi.fn(),
      }),
    ).rejects.toThrow('route r9')
  })
})
