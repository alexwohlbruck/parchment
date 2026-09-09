/**
 * Tests for the versioned crypto envelope (v2) with AAD binding.
 *
 * Covers:
 * - Round-trip encrypt/decrypt (bytes + string variants)
 * - AAD tampering is detected on decrypt
 * - Wrong key is detected on decrypt
 * - Wrong envelope version is rejected
 * - Legacy v1 blob back-compat through decryptAny
 * - Deterministic AAD encoding
 * - Envelope version inspection without decryption
 */

import { describe, test, expect } from 'vitest'
import {
  encryptEnvelopeBytes,
  decryptEnvelopeBytes,
  encryptEnvelopeString,
  decryptEnvelopeString,
  decryptAny,
  encodeAAD,
  readEnvelopeVersion,
  isV2Envelope,
  ENVELOPE_VERSION_V2,
  ALGO_AES_256_GCM,
  EnvelopeError,
  type AAD,
  type LegacyV1Blob,
} from './crypto-envelope'
import { gcm } from '@noble/ciphers/aes.js'
import { bytesToBase64, base64ToBytes } from './federation-crypto'

function key(byte: number): Uint8Array {
  const k = new Uint8Array(32)
  k.fill(byte)
  return k
}

const aadFixture: AAD = {
  userId: 'user-123',
  recordType: 'collection',
  recordId: 'col-abc',
  keyContext: 'parchment-collection-col-abc',
}

describe('encodeAAD', () => {
  test('produces deterministic bytes across calls', () => {
    const a = encodeAAD(aadFixture)
    const b = encodeAAD({ ...aadFixture })
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  test('distinct AADs produce distinct bytes', () => {
    const a = encodeAAD(aadFixture)
    const b = encodeAAD({ ...aadFixture, recordId: 'col-xyz' })
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })

  test('empty-field AAD is accepted and bytes still distinguishable', () => {
    const a = encodeAAD({
      userId: '',
      recordType: '',
      recordId: '',
      keyContext: '',
    })
    const b = encodeAAD({
      userId: 'x',
      recordType: '',
      recordId: '',
      keyContext: '',
    })
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })

  test('throws on oversized field (> 65535 bytes)', () => {
    expect(() =>
      encodeAAD({
        userId: 'a'.repeat(70_000),
        recordType: '',
        recordId: '',
        keyContext: '',
      }),
    ).toThrow()
  })
})

describe('encryptEnvelopeBytes / decryptEnvelopeBytes', () => {
  test('round-trips UTF-8 plaintext', () => {
    const k = key(7)
    const env = encryptEnvelopeBytes({
      plaintext: new TextEncoder().encode('the quick brown fox'),
      key: k,
      aad: aadFixture,
    })
    const pt = decryptEnvelopeBytes({ envelope: env, key: k, aad: aadFixture })
    expect(new TextDecoder().decode(pt)).toBe('the quick brown fox')
  })

  test('writes v2 version byte and AES-GCM algo byte', () => {
    const env = encryptEnvelopeBytes({
      plaintext: new TextEncoder().encode('x'),
      key: key(3),
      aad: aadFixture,
    })
    expect(env[0]).toBe(ENVELOPE_VERSION_V2)
    expect(env[1]).toBe(ALGO_AES_256_GCM)
  })

  test('nonce is random per call (same plaintext → different ciphertext)', () => {
    const k = key(5)
    const a = encryptEnvelopeBytes({
      plaintext: new TextEncoder().encode('same'),
      key: k,
      aad: aadFixture,
    })
    const b = encryptEnvelopeBytes({
      plaintext: new TextEncoder().encode('same'),
      key: k,
      aad: aadFixture,
    })
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })

  test('wrong key throws on decrypt', () => {
    const env = encryptEnvelopeBytes({
      plaintext: new TextEncoder().encode('secret'),
      key: key(1),
      aad: aadFixture,
    })
    expect(() =>
      decryptEnvelopeBytes({ envelope: env, key: key(2), aad: aadFixture }),
    ).toThrow()
  })

  test('tampered AAD throws on decrypt', () => {
    const k = key(9)
    const env = encryptEnvelopeBytes({
      plaintext: new TextEncoder().encode('secret'),
      key: k,
      aad: aadFixture,
    })
    const tampered: AAD = { ...aadFixture, recordId: 'col-xyz' }
    expect(() =>
      decryptEnvelopeBytes({ envelope: env, key: k, aad: tampered }),
    ).toThrow()
  })

  test('tampered ciphertext byte throws on decrypt', () => {
    const k = key(11)
    const env = encryptEnvelopeBytes({
      plaintext: new TextEncoder().encode('secret'),
      key: k,
      aad: aadFixture,
    })
    // Flip a bit inside the ciphertext region.
    env[env.length - 5] ^= 0x01
    expect(() =>
      decryptEnvelopeBytes({ envelope: env, key: k, aad: aadFixture }),
    ).toThrow()
  })

  test('wrong version byte is rejected with EnvelopeError', () => {
    const k = key(13)
    const env = encryptEnvelopeBytes({
      plaintext: new TextEncoder().encode('x'),
      key: k,
      aad: aadFixture,
    })
    env[0] = 0x09
    expect(() =>
      decryptEnvelopeBytes({ envelope: env, key: k, aad: aadFixture }),
    ).toThrow(EnvelopeError)
  })

  test('wrong algo byte is rejected with EnvelopeError', () => {
    const k = key(15)
    const env = encryptEnvelopeBytes({
      plaintext: new TextEncoder().encode('x'),
      key: k,
      aad: aadFixture,
    })
    env[1] = 0x09
    expect(() =>
      decryptEnvelopeBytes({ envelope: env, key: k, aad: aadFixture }),
    ).toThrow(EnvelopeError)
  })

  test('truncated envelope is rejected with EnvelopeError', () => {
    expect(() =>
      decryptEnvelopeBytes({
        envelope: new Uint8Array([0x02, 0x01, 0x00]),
        key: key(1),
        aad: aadFixture,
      }),
    ).toThrow(EnvelopeError)
  })

  test('rejects non-32-byte key', () => {
    expect(() =>
      encryptEnvelopeBytes({
        plaintext: new TextEncoder().encode('x'),
        key: new Uint8Array(16),
        aad: aadFixture,
      }),
    ).toThrow(EnvelopeError)
  })
})

describe('encryptEnvelopeString / decryptEnvelopeString', () => {
  test('base64 round-trip', () => {
    const k = key(21)
    const s = encryptEnvelopeString({
      plaintext: 'hello world',
      key: k,
      aad: aadFixture,
    })
    expect(typeof s).toBe('string')
    expect(s.length).toBeGreaterThan(0)
    const back = decryptEnvelopeString({
      envelope: s,
      key: k,
      aad: aadFixture,
    })
    expect(back).toBe('hello world')
  })
})

describe('decryptAny (v1 back-compat)', () => {
  test('decrypts a legacy v1 blob with no AAD binding', () => {
    // Construct a legacy v1 blob by hand (no envelope wrapper, no AAD).
    const k = key(31)
    const nonce = new Uint8Array(12)
    for (let i = 0; i < 12; i++) nonce[i] = i
    const plaintext = new TextEncoder().encode('legacy data')
    const cipher = gcm(k, nonce)
    const ciphertext = cipher.encrypt(plaintext)
    const legacy: LegacyV1Blob = {
      ciphertext: bytesToBase64(ciphertext),
      nonce: bytesToBase64(nonce),
    }

    const out = decryptAny({ input: legacy, key: k, aad: aadFixture })
    expect(out).toBe('legacy data')
  })

  test('decrypts a v2 envelope passed as base64', () => {
    const k = key(41)
    const s = encryptEnvelopeString({
      plaintext: 'v2 payload',
      key: k,
      aad: aadFixture,
    })
    const out = decryptAny({ input: s, key: k, aad: aadFixture })
    expect(out).toBe('v2 payload')
  })

  test('decrypts a v2 envelope passed as Uint8Array', () => {
    const k = key(51)
    const env = encryptEnvelopeBytes({
      plaintext: new TextEncoder().encode('bytes path'),
      key: k,
      aad: aadFixture,
    })
    const out = decryptAny({ input: env, key: k, aad: aadFixture })
    expect(out).toBe('bytes path')
  })
})

describe('envelope version inspection', () => {
  test('readEnvelopeVersion returns version byte without decrypting', () => {
    const env = encryptEnvelopeBytes({
      plaintext: new TextEncoder().encode('x'),
      key: key(61),
      aad: aadFixture,
    })
    expect(readEnvelopeVersion(env)).toBe(ENVELOPE_VERSION_V2)
    expect(isV2Envelope(env)).toBe(true)
  })

  test('readEnvelopeVersion accepts base64', () => {
    const s = encryptEnvelopeString({
      plaintext: 'x',
      key: key(63),
      aad: aadFixture,
    })
    expect(readEnvelopeVersion(s)).toBe(ENVELOPE_VERSION_V2)
    expect(isV2Envelope(s)).toBe(true)
  })

  test('readEnvelopeVersion returns null on empty input', () => {
    expect(readEnvelopeVersion(new Uint8Array(0))).toBeNull()
  })

  test('isV2Envelope returns false for non-v2 bytes', () => {
    expect(isV2Envelope(new Uint8Array([0x01, 0x01, 0x00]))).toBe(false)
    expect(isV2Envelope(base64ToBytes('YWJj'))).toBe(false)
  })
})
