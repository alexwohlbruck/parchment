/**
 * Tests for collection + canvas metadata encryption.
 */

import { describe, test, expect } from 'vitest'
import {
  encryptCollectionMetadata,
  decryptCollectionMetadata,
  encryptCanvasMetadata,
  decryptCanvasMetadata,
} from './library-crypto'

function seedOf(byte: number): Uint8Array {
  const s = new Uint8Array(32)
  s.fill(byte)
  return s
}

const seed = seedOf(0x81)
const userId = 'user-1'

describe('encryptCollectionMetadata / decryptCollectionMetadata', () => {
  test('round-trips', () => {
    const meta = {
      name: 'Favorites',
      description: 'coffee + bookstores',
      icon: 'star',
      iconColor: '#f43',
    }
    const env = encryptCollectionMetadata({
      metadata: meta,
      seed,
      userId,
      collectionId: 'c1',
    })
    const out = decryptCollectionMetadata({
      envelope: env,
      seed,
      userId,
      collectionId: 'c1',
    })
    expect(out).toEqual(meta)
  })

  test('AAD binds collection id — wrong id fails', () => {
    const env = encryptCollectionMetadata({
      metadata: { name: 'x' },
      seed,
      userId,
      collectionId: 'c1',
    })
    expect(() =>
      decryptCollectionMetadata({
        envelope: env,
        seed,
        userId,
        collectionId: 'c2',
      }),
    ).toThrow()
  })

  test('different users cannot decrypt', () => {
    const env = encryptCollectionMetadata({
      metadata: { name: 'x' },
      seed,
      userId,
      collectionId: 'c1',
    })
    expect(() =>
      decryptCollectionMetadata({
        envelope: env,
        seed,
        userId: 'user-2',
        collectionId: 'c1',
      }),
    ).toThrow()
  })
})

describe('encryptCanvasMetadata / decryptCanvasMetadata', () => {
  test('round-trips with arbitrary style blob', () => {
    const meta = {
      name: 'Trip plan',
      description: 'weekend in NYC',
      style: { strokeWidth: 3, accentColor: '#09f' },
    }
    const env = encryptCanvasMetadata({
      metadata: meta,
      seed,
      userId,
      canvasId: 'canvas-1',
    })
    const out = decryptCanvasMetadata({
      envelope: env,
      seed,
      userId,
      canvasId: 'canvas-1',
    })
    expect(out).toEqual(meta)
  })

  test('canvas + collection with the same id are separately keyed', () => {
    const collEnv = encryptCollectionMetadata({
      metadata: { name: 'col' },
      seed,
      userId,
      collectionId: 'same-id',
    })
    // Attempting to decrypt the collection envelope as a canvas must fail —
    // different HKDF context + different AAD recordType.
    expect(() =>
      decryptCanvasMetadata({
        envelope: collEnv,
        seed,
        userId,
        canvasId: 'same-id',
      }),
    ).toThrow()
  })
})
