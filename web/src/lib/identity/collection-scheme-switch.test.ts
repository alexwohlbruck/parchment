import { describe, test, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  seed: new Uint8Array(32).fill(0x42),
  apiPost: vi.fn(async (_url: string, body: Record<string, unknown>) => ({
    data: body,
  })),
}))

vi.mock('@/lib/identity/key-storage', () => ({
  getSeed: async () => hoisted.seed,
}))

vi.mock('@/lib/api', () => ({
  api: { post: hoisted.apiPost },
}))

import { deriveEncryptionKeyPair } from './federation-crypto'
import {
  decryptCollectionMetadata,
  encryptCollectionMetadata,
} from './library-crypto'
import {
  downgradeCollectionToServerKey,
  upgradeCollectionToE2ee,
} from './collection-scheme-switch'
import type { Collection } from '@/types/library.types'

const ownerUserId = 'alice'
const ownerEncryptionPrivateKey = deriveEncryptionKeyPair(hoisted.seed).privateKey

const metadata = {
  name: 'Coffee',
  description: 'Weekend spots',
  icon: 'cafe',
  iconPack: 'maki' as const,
  iconColor: 'rose',
}

function collectionOf(overrides: Partial<Collection>): Collection {
  return {
    id: 'coll-1',
    userId: ownerUserId,
    isPublic: false,
    scheme: 'server-key',
    resharingPolicy: 'owner-only',
    metadataKeyVersion: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...metadata,
    ...overrides,
  }
}

function sentBody() {
  return hoisted.apiPost.mock.calls[0][1] as Record<string, any>
}

beforeEach(() => {
  hoisted.apiPost.mockClear()
})

describe('upgradeCollectionToE2ee', () => {
  test('seals the metadata so the owner reads it back at the new version', async () => {
    await upgradeCollectionToE2ee({
      collection: collectionOf({}),
      ownerUserId,
      currentBookmarks: [],
      remainingShares: [],
      ownerEncryptionPrivateKey,
    })

    const body = sentBody()
    expect(body.metadata).toBeUndefined()
    expect(
      decryptCollectionMetadata({
        envelope: body.newMetadataEncrypted,
        seed: hoisted.seed,
        userId: ownerUserId,
        collectionId: 'coll-1',
        keyVersion: body.newMetadataKeyVersion,
      }),
    ).toEqual(metadata)
  })
})

describe('downgradeCollectionToServerKey', () => {
  test('hands the server the metadata in the clear, with no envelope', async () => {
    await downgradeCollectionToServerKey({
      collection: collectionOf({
        scheme: 'user-e2ee',
        metadataEncrypted: encryptCollectionMetadata({
          metadata,
          seed: hoisted.seed,
          userId: ownerUserId,
          collectionId: 'coll-1',
        }),
      }),
      ownerUserId,
      currentPoints: [],
      remainingShares: [],
      ownerEncryptionPrivateKey,
    })

    const body = sentBody()
    expect(body.metadata).toEqual(metadata)
    expect(body.newMetadataEncrypted).toBeUndefined()
  })
})
