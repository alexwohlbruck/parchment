/**
 * Integration-style tests for the collection-key rotation orchestrator.
 *
 * Stubs only the HTTP layer and the local seed store; every piece of real
 * crypto (HKDF collection-key derivation, AES-GCM envelope encryption,
 * ECIES friend-wrap) runs so regressions like "we forgot to bump
 * metadataKeyVersion" or "we used the wrong AAD" actually fail a test.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => {
  const state = {
    storedSeed: null as Uint8Array | null,
    lastRotatePayload: null as unknown,
  }
  return {
    state,
    apiPostSpy: vi.fn(async (url: string, body?: unknown) => {
      if (url.endsWith('/rotate-key')) {
        state.lastRotatePayload = body
        return {
          data: {
            id: 'coll-1',
            userId: 'alice',
            isPublic: false,
            scheme: 'user-e2ee',
            resharingPolicy: 'owner-only',
            metadataEncrypted: (body as any).newMetadataEncrypted,
            metadataKeyVersion: (body as any).newMetadataKeyVersion,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }
      }
      throw new Error(`Unexpected POST ${url}`)
    }),
  }
})

vi.mock('@/lib/key-storage', () => ({
  getSeed: async () => hoisted.state.storedSeed,
  storeSeed: async (seed: Uint8Array) => {
    hoisted.state.storedSeed = seed
  },
}))

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: hoisted.apiPostSpy,
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
  isTauri: false,
}))

import {
  generateSeed,
  deriveEncryptionKeyPair,
  deriveCollectionKey,
  exportPublicKey,
  encryptForFriend,
  decryptFromFriend,
  importPublicKey,
} from '@/lib/federation-crypto'
import { encryptEnvelopeString, decryptEnvelopeString } from '@/lib/crypto-envelope'
import { rotateCollectionKey } from './collection-rotation'

const { state, apiPostSpy } = hoisted

beforeEach(() => {
  vi.clearAllMocks()
  state.storedSeed = null
  state.lastRotatePayload = null
})

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

describe('rotateCollectionKey', () => {
  test('re-encrypts points + bumps key version + drops revoked recipient', async () => {
    const seed = generateSeed()
    state.storedSeed = seed

    const ownerUserId = 'alice'
    const collectionId = 'coll-1'

    // Friend (Bob) gets rewrapped. Friend (Eve) gets revoked.
    const bobKeys = deriveEncryptionKeyPair(generateSeed())
    const eveKeys = deriveEncryptionKeyPair(generateSeed())

    const oldKey = deriveCollectionKey(seed, collectionId, 1)

    const pointId = 'pt-1'
    const ciphertextOld = encryptEnvelopeString({
      plaintext: '{"lat":40,"lng":-80,"name":"Test"}',
      key: oldKey,
      aad: aadFor(collectionId, 'encrypted-point', pointId, ownerUserId),
    })
    const metadataOld = encryptEnvelopeString({
      plaintext: '{"name":"My Collection"}',
      key: oldKey,
      aad: aadFor(
        collectionId,
        'collection-metadata',
        collectionId,
        ownerUserId,
      ),
    })

    const ownerEnc = deriveEncryptionKeyPair(seed)

    const result = await rotateCollectionKey({
      collection: {
        id: collectionId,
        userId: ownerUserId,
        isPublic: false,
        scheme: 'user-e2ee',
        resharingPolicy: 'owner-only',
        metadataEncrypted: metadataOld,
        metadataKeyVersion: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      ownerUserId,
      currentPoints: [
        { id: pointId, encryptedData: ciphertextOld, nonce: '' },
      ],
      remainingShares: [
        {
          id: 'share-bob',
          recipientHandle: 'bob@peer.test',
          recipientEncryptionKey: exportPublicKey(bobKeys.publicKey),
        },
      ],
      revokeRecipientHandles: ['eve@peer.test'],
      ownerEncryptionPrivateKey: ownerEnc.privateKey,
    })

    expect(result.metadataKeyVersion).toBe(2)
    expect(apiPostSpy).toHaveBeenCalledTimes(1)

    const payload = state.lastRotatePayload as {
      newMetadataEncrypted: string
      newMetadataKeyVersion: number
      newEncryptedPoints: Array<{ id: string; encryptedData: string }>
      updatedShareEnvelopes: Array<{
        recipientHandle: string
        encryptedData: string
        nonce: string
      }>
      revokeRecipientHandles: string[]
    }

    // Version advanced.
    expect(payload.newMetadataKeyVersion).toBe(2)

    // Revoked list passes through verbatim.
    expect(payload.revokeRecipientHandles).toEqual(['eve@peer.test'])

    // Eve is NOT in the rewrapped set.
    expect(
      payload.updatedShareEnvelopes.find(
        (s) => s.recipientHandle === 'eve@peer.test',
      ),
    ).toBeUndefined()

    // Bob's rewrapped envelope decrypts to the RAW bytes of the new key.
    // This proves we wrapped the fresh key, not the old one.
    const bobEnvelope = payload.updatedShareEnvelopes.find(
      (s) => s.recipientHandle === 'bob@peer.test',
    )
    expect(bobEnvelope).toBeDefined()

    const ownerPub = ownerEnc.publicKey
    const decrypted = decryptFromFriend(
      bobEnvelope!.encryptedData,
      bobEnvelope!.nonce,
      bobKeys.privateKey,
      ownerPub,
      `parchment-collection-key-wrap:${collectionId}`,
    )
    const newKeyB64 = decrypted
    const newKeyBytes = Uint8Array.from(atob(newKeyB64), (c) => c.charCodeAt(0))
    const expectedNewKey = deriveCollectionKey(seed, collectionId, 2)
    expect(newKeyBytes).toEqual(expectedNewKey)

    // New point ciphertext actually decrypts under the new key with the
    // right AAD — catches "we didn't bind AAD to the new key" bugs.
    const reencrypted = payload.newEncryptedPoints[0]
    const roundtrip = decryptEnvelopeString({
      envelope: reencrypted.encryptedData,
      key: expectedNewKey,
      aad: aadFor(collectionId, 'encrypted-point', pointId, ownerUserId),
    })
    expect(roundtrip).toBe('{"lat":40,"lng":-80,"name":"Test"}')
  })

  test('throws when local seed is missing', async () => {
    state.storedSeed = null
    const owner = deriveEncryptionKeyPair(generateSeed())
    await expect(
      rotateCollectionKey({
        collection: {
          id: 'c',
          userId: 'alice',
          isPublic: false,
          scheme: 'user-e2ee',
          resharingPolicy: 'owner-only',
          metadataKeyVersion: 1,
          createdAt: '',
          updatedAt: '',
        },
        ownerUserId: 'alice',
        currentPoints: [],
        remainingShares: [],
        revokeRecipientHandles: [],
        ownerEncryptionPrivateKey: owner.privateKey,
      }),
    ).rejects.toThrow(/seed/i)
  })

  test('fires all progress phases in order', async () => {
    state.storedSeed = generateSeed()
    const owner = deriveEncryptionKeyPair(state.storedSeed!)

    const phases: string[] = []
    await rotateCollectionKey({
      collection: {
        id: 'c',
        userId: 'alice',
        isPublic: false,
        scheme: 'user-e2ee',
        resharingPolicy: 'owner-only',
        metadataKeyVersion: 1,
        createdAt: '',
        updatedAt: '',
      },
      ownerUserId: 'alice',
      currentPoints: [],
      remainingShares: [],
      revokeRecipientHandles: [],
      ownerEncryptionPrivateKey: owner.privateKey,
      onProgress: (phase) => {
        if (!phases.includes(phase)) phases.push(phase)
      },
    })

    expect(phases).toEqual([
      'decrypting',
      'encrypting',
      'rewrapping',
      'committing',
      'done',
    ])
  })
})
