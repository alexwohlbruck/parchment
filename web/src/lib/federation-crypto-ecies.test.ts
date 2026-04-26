/**
 * Tests for ECIES v2 friend sharing (forward-secret per-message ephemeral
 * sender keys).
 *
 * Covers:
 * - Happy-path round-trip
 * - Per-message ephemeral: two encrypts of the same plaintext produce
 *   different ciphertexts AND different ephemeral pubs
 * - Signature tampering is rejected
 * - Envelope tampering is rejected
 * - Ephemeral-pub tampering is rejected (fails at signature check)
 * - AAD binding: mismatched sender/recipient/relationship/timestamp fail
 * - Wrong recipient key fails cleanly
 */

import { describe, test, expect, beforeAll } from 'vitest'
import {
  deriveAllKeys,
  encryptForFriendV2,
  decryptForFriendV2,
  encryptLocationForFriendV2,
  decryptLocationFromFriendV2,
  base64ToBytes,
  bytesToBase64,
  type LocationData,
  type FriendShareBinding,
} from './federation-crypto'

function seedOf(byte: number): Uint8Array {
  const s = new Uint8Array(32)
  s.fill(byte)
  return s
}

describe('encryptForFriendV2 / decryptForFriendV2', () => {
  let aliceSeed: Uint8Array
  let bobSeed: Uint8Array
  let aliceKeys: ReturnType<typeof deriveAllKeys>
  let bobKeys: ReturnType<typeof deriveAllKeys>
  let binding: FriendShareBinding

  beforeAll(() => {
    aliceSeed = seedOf(0x11)
    bobSeed = seedOf(0x22)
    aliceKeys = deriveAllKeys(aliceSeed)
    bobKeys = deriveAllKeys(bobSeed)

    binding = {
      senderId: 'alice@a.example',
      recipientId: 'bob@b.example',
      relationshipId: 'rel-alice-bob',
      timestamp: '2026-04-20T12:00:00.000Z',
    }
  })

  test('round-trips plaintext', async () => {
    const blob = await encryptForFriendV2({
      plaintext: 'hello bob, this is alice',
      mySigningPrivateKey: aliceKeys.signing.privateKey,
      friendEncryptionPublicKey: bobKeys.encryption.publicKey,
      binding,
    })
    const out = decryptForFriendV2({
      blob,
      myEncryptionPrivateKey: bobKeys.encryption.privateKey,
      senderSigningPublicKey: aliceKeys.signing.publicKey,
      binding,
    })
    expect(out).toBe('hello bob, this is alice')
  })

  test('two encrypts of the same plaintext produce different blobs', async () => {
    const a = await encryptForFriendV2({
      plaintext: 'same',
      mySigningPrivateKey: aliceKeys.signing.privateKey,
      friendEncryptionPublicKey: bobKeys.encryption.publicKey,
      binding,
    })
    const b = await encryptForFriendV2({
      plaintext: 'same',
      mySigningPrivateKey: aliceKeys.signing.privateKey,
      friendEncryptionPublicKey: bobKeys.encryption.publicKey,
      binding,
    })
    expect(a).not.toBe(b)
  })

  test('two encrypts emit different ephemeral pubs (forward-secrecy shape)', async () => {
    const a = base64ToBytes(
      await encryptForFriendV2({
        plaintext: 'x',
        mySigningPrivateKey: aliceKeys.signing.privateKey,
        friendEncryptionPublicKey: bobKeys.encryption.publicKey,
        binding,
      }),
    )
    const b = base64ToBytes(
      await encryptForFriendV2({
        plaintext: 'x',
        mySigningPrivateKey: aliceKeys.signing.privateKey,
        friendEncryptionPublicKey: bobKeys.encryption.publicKey,
        binding,
      }),
    )
    // First 32 bytes are the ephemeral X25519 public.
    const ephA = a.slice(0, 32)
    const ephB = b.slice(0, 32)
    expect(Array.from(ephA)).not.toEqual(Array.from(ephB))
  })

  test('wrong recipient key cannot decrypt', async () => {
    const blob = await encryptForFriendV2({
      plaintext: 'for bob',
      mySigningPrivateKey: aliceKeys.signing.privateKey,
      friendEncryptionPublicKey: bobKeys.encryption.publicKey,
      binding,
    })
    const carolKeys = deriveAllKeys(seedOf(0x33))
    expect(() =>
      decryptForFriendV2({
        blob,
        myEncryptionPrivateKey: carolKeys.encryption.privateKey,
        senderSigningPublicKey: aliceKeys.signing.publicKey,
        binding,
      }),
    ).toThrow()
  })

  test('tampering with the signature is rejected', async () => {
    const blob = await encryptForFriendV2({
      plaintext: 'x',
      mySigningPrivateKey: aliceKeys.signing.privateKey,
      friendEncryptionPublicKey: bobKeys.encryption.publicKey,
      binding,
    })
    const raw = base64ToBytes(blob)
    // Flip a bit in the signature (last 64 bytes).
    raw[raw.length - 1] ^= 0x01
    expect(() =>
      decryptForFriendV2({
        blob: bytesToBase64(raw),
        myEncryptionPrivateKey: bobKeys.encryption.privateKey,
        senderSigningPublicKey: aliceKeys.signing.publicKey,
        binding,
      }),
    ).toThrow(/signature/i)
  })

  test('tampering with the envelope body fails at signature check', async () => {
    const blob = await encryptForFriendV2({
      plaintext: 'x',
      mySigningPrivateKey: aliceKeys.signing.privateKey,
      friendEncryptionPublicKey: bobKeys.encryption.publicKey,
      binding,
    })
    const raw = base64ToBytes(blob)
    // Flip a bit in the envelope region (between 32-byte eph_pub and 64-byte
    // trailing signature).
    const mid = 32 + 8 // well inside the envelope
    raw[mid] ^= 0x01
    expect(() =>
      decryptForFriendV2({
        blob: bytesToBase64(raw),
        myEncryptionPrivateKey: bobKeys.encryption.privateKey,
        senderSigningPublicKey: aliceKeys.signing.publicKey,
        binding,
      }),
    ).toThrow(/signature/i)
  })

  test('tampering with the ephemeral pub fails at signature check', async () => {
    const blob = await encryptForFriendV2({
      plaintext: 'x',
      mySigningPrivateKey: aliceKeys.signing.privateKey,
      friendEncryptionPublicKey: bobKeys.encryption.publicKey,
      binding,
    })
    const raw = base64ToBytes(blob)
    raw[5] ^= 0x01 // inside the leading 32-byte eph_pub
    expect(() =>
      decryptForFriendV2({
        blob: bytesToBase64(raw),
        myEncryptionPrivateKey: bobKeys.encryption.privateKey,
        senderSigningPublicKey: aliceKeys.signing.publicKey,
        binding,
      }),
    ).toThrow(/signature/i)
  })

  test('wrong sender public key is rejected', async () => {
    const blob = await encryptForFriendV2({
      plaintext: 'x',
      mySigningPrivateKey: aliceKeys.signing.privateKey,
      friendEncryptionPublicKey: bobKeys.encryption.publicKey,
      binding,
    })
    const impostorKeys = deriveAllKeys(seedOf(0x99))
    expect(() =>
      decryptForFriendV2({
        blob,
        myEncryptionPrivateKey: bobKeys.encryption.privateKey,
        senderSigningPublicKey: impostorKeys.signing.publicKey,
        binding,
      }),
    ).toThrow(/signature/i)
  })

  test('AAD binding: wrong relationshipId fails AEAD', async () => {
    const blob = await encryptForFriendV2({
      plaintext: 'x',
      mySigningPrivateKey: aliceKeys.signing.privateKey,
      friendEncryptionPublicKey: bobKeys.encryption.publicKey,
      binding,
    })
    expect(() =>
      decryptForFriendV2({
        blob,
        myEncryptionPrivateKey: bobKeys.encryption.privateKey,
        senderSigningPublicKey: aliceKeys.signing.publicKey,
        binding: { ...binding, relationshipId: 'different' },
      }),
    ).toThrow()
  })

  test('AAD binding: wrong timestamp fails AEAD', async () => {
    const blob = await encryptForFriendV2({
      plaintext: 'x',
      mySigningPrivateKey: aliceKeys.signing.privateKey,
      friendEncryptionPublicKey: bobKeys.encryption.publicKey,
      binding,
    })
    expect(() =>
      decryptForFriendV2({
        blob,
        myEncryptionPrivateKey: bobKeys.encryption.privateKey,
        senderSigningPublicKey: aliceKeys.signing.publicKey,
        binding: { ...binding, timestamp: '2099-01-01T00:00:00Z' },
      }),
    ).toThrow()
  })

  test('AAD binding: wrong senderId fails AEAD', async () => {
    const blob = await encryptForFriendV2({
      plaintext: 'x',
      mySigningPrivateKey: aliceKeys.signing.privateKey,
      friendEncryptionPublicKey: bobKeys.encryption.publicKey,
      binding,
    })
    expect(() =>
      decryptForFriendV2({
        blob,
        myEncryptionPrivateKey: bobKeys.encryption.privateKey,
        senderSigningPublicKey: aliceKeys.signing.publicKey,
        binding: { ...binding, senderId: 'mallory@m.example' },
      }),
    ).toThrow()
  })

  test('rejects a truncated blob', () => {
    expect(() =>
      decryptForFriendV2({
        blob: bytesToBase64(new Uint8Array(10)),
        myEncryptionPrivateKey: bobKeys.encryption.privateKey,
        senderSigningPublicKey: aliceKeys.signing.publicKey,
        binding,
      }),
    ).toThrow(/too short/i)
  })
})

describe('encryptLocationForFriendV2 / decryptLocationFromFriendV2', () => {
  test('round-trips LocationData exactly', async () => {
    const aliceKeys = deriveAllKeys(seedOf(0x41))
    const bobKeys = deriveAllKeys(seedOf(0x42))
    const loc: LocationData = {
      lat: 37.7749,
      lng: -122.4194,
      accuracy: 5,
      altitude: 16,
      altitudeAccuracy: 3,
      speed: 0,
      heading: 90,
      battery: 0.72,
      batteryCharging: true,
      timestamp: 1_700_000_000_000,
    }
    const binding: FriendShareBinding = {
      senderId: 'alice@a',
      recipientId: 'bob@b',
      relationshipId: 'r',
      timestamp: '2026-04-20T12:00:00Z',
    }
    const blob = await encryptLocationForFriendV2({
      location: loc,
      mySigningPrivateKey: aliceKeys.signing.privateKey,
      friendEncryptionPublicKey: bobKeys.encryption.publicKey,
      binding,
    })
    const out = decryptLocationFromFriendV2({
      blob,
      myEncryptionPrivateKey: bobKeys.encryption.privateKey,
      senderSigningPublicKey: aliceKeys.signing.publicKey,
      binding,
    })
    expect(out).toEqual(loc)
  })
})
