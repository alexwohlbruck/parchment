import { describe, test, expect } from 'vitest'
import { deriveEncryptionKeyPair, generateSeed } from './federation-crypto'
import { openCollectionShare, sealCollectionShare } from './collection-share'

const owner = deriveEncryptionKeyPair(generateSeed())
const friend = deriveEncryptionKeyPair(generateSeed())
const stranger = deriveEncryptionKeyPair(generateSeed())

describe('collection share envelopes', () => {
  test('a friend opens the key their owner sealed for them', () => {
    const key = new Uint8Array(32).fill(9)
    const envelope = sealCollectionShare({
      share: { collectionId: 'c1', scheme: 'user-e2ee', key, keyVersion: 3 },
      ownerPrivateKey: owner.privateKey,
      recipientPublicKey: friend.publicKey,
    })

    expect(
      openCollectionShare({
        envelope,
        recipientPrivateKey: friend.privateKey,
        senderPublicKey: owner.publicKey,
      }),
    ).toEqual({ collectionId: 'c1', scheme: 'user-e2ee', key, keyVersion: 3 })
  })

  test('a shareable collection travels without a key', () => {
    const envelope = sealCollectionShare({
      share: { collectionId: 'c1', scheme: 'server-key' },
      ownerPrivateKey: owner.privateKey,
      recipientPublicKey: friend.publicKey,
    })

    const opened = openCollectionShare({
      envelope,
      recipientPrivateKey: friend.privateKey,
      senderPublicKey: owner.publicKey,
    })
    expect(opened.key).toBeUndefined()
  })

  test('nobody else can open it', () => {
    const envelope = sealCollectionShare({
      share: { collectionId: 'c1', scheme: 'user-e2ee', key: new Uint8Array(32) },
      ownerPrivateKey: owner.privateKey,
      recipientPublicKey: friend.publicKey,
    })

    expect(() =>
      openCollectionShare({
        envelope,
        recipientPrivateKey: stranger.privateKey,
        senderPublicKey: owner.publicKey,
      }),
    ).toThrow()
  })
})
