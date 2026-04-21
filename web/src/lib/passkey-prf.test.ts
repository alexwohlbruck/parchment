/**
 * Tests for passkey-PRF wrapped K_m slot building and unwrapping.
 *
 * Verifies:
 *  - Deterministic salt derivation per user id
 *  - Round-trip wrap + unwrap
 *  - Slot signature catches tampering
 *  - Unwrap without verified-signature token throws
 *  - Wrong PRF output fails
 */

import { describe, test, expect } from 'vitest'
import {
  derivePrfSalt,
  deriveWrapKey,
  buildWrappedKmSlot,
  unwrapKmFromSlot,
  verifyWrappedKmSlot,
  CURRENT_WRAP_ALGO,
} from './passkey-prf'
import { deriveSigningKeyPair } from './federation-crypto'

function bytesOf(byte: number, len = 32): Uint8Array {
  const out = new Uint8Array(len)
  out.fill(byte)
  return out
}

describe('derivePrfSalt', () => {
  test('deterministic for a given userId', () => {
    const a = derivePrfSalt('user-1')
    const b = derivePrfSalt('user-1')
    expect(Array.from(a)).toEqual(Array.from(b))
    expect(a.length).toBe(32)
  })

  test('different userIds → different salts', () => {
    const a = derivePrfSalt('user-1')
    const b = derivePrfSalt('user-2')
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })
})

describe('deriveWrapKey', () => {
  test('deterministic + 32 bytes', () => {
    const prf = bytesOf(0x77)
    const k1 = deriveWrapKey(prf)
    const k2 = deriveWrapKey(prf)
    expect(Array.from(k1)).toEqual(Array.from(k2))
    expect(k1.length).toBe(32)
  })

  test('rejects too-short PRF output', () => {
    expect(() => deriveWrapKey(new Uint8Array(8))).toThrow()
  })
})

describe('wrap + unwrap round-trip', () => {
  test('round-trips the seed through wrap+unwrap', async () => {
    const seed = bytesOf(0xaa)
    const prfOutput = bytesOf(0xbb)
    const keys = deriveSigningKeyPair(bytesOf(0xcc))

    const slot = await buildWrappedKmSlot({
      seed,
      prfOutput,
      userId: 'user-1',
      credentialId: 'cred-abc',
      identitySigningPrivateKey: keys.privateKey,
    })
    expect(slot.wrapAlgo).toBe(CURRENT_WRAP_ALGO)

    const valid = verifyWrappedKmSlot({
      slot,
      userId: 'user-1',
      identitySigningPublicKey: keys.publicKey,
    })
    expect(valid).toBe(true)

    const recovered = unwrapKmFromSlot({
      slot,
      prfOutput,
      userId: 'user-1',
      verifiedSignature: true,
    })
    expect(Array.from(recovered)).toEqual(Array.from(seed))
  })
})

describe('slot signature tampering', () => {
  test('mutated wrappedKm fails verification', async () => {
    const seed = bytesOf(0xaa)
    const prfOutput = bytesOf(0xbb)
    const keys = deriveSigningKeyPair(bytesOf(0xcc))

    const slot = await buildWrappedKmSlot({
      seed,
      prfOutput,
      userId: 'user-1',
      credentialId: 'cred-abc',
      identitySigningPrivateKey: keys.privateKey,
    })

    const tampered = { ...slot, wrappedKm: slot.wrappedKm.slice(0, -4) + 'AAAA' }
    const valid = verifyWrappedKmSlot({
      slot: tampered,
      userId: 'user-1',
      identitySigningPublicKey: keys.publicKey,
    })
    expect(valid).toBe(false)
  })

  test('wrong userId context fails verification', async () => {
    const seed = bytesOf(0xaa)
    const prfOutput = bytesOf(0xbb)
    const keys = deriveSigningKeyPair(bytesOf(0xcc))

    const slot = await buildWrappedKmSlot({
      seed,
      prfOutput,
      userId: 'user-1',
      credentialId: 'cred-abc',
      identitySigningPrivateKey: keys.privateKey,
    })

    expect(
      verifyWrappedKmSlot({
        slot,
        userId: 'user-2',
        identitySigningPublicKey: keys.publicKey,
      }),
    ).toBe(false)
  })
})

describe('unwrap guards', () => {
  test('wrong PRF output fails decrypt', async () => {
    const seed = bytesOf(0xaa)
    const correctPrf = bytesOf(0xbb)
    const wrongPrf = bytesOf(0xee)
    const keys = deriveSigningKeyPair(bytesOf(0xcc))

    const slot = await buildWrappedKmSlot({
      seed,
      prfOutput: correctPrf,
      userId: 'user-1',
      credentialId: 'cred-abc',
      identitySigningPrivateKey: keys.privateKey,
    })

    expect(() =>
      unwrapKmFromSlot({
        slot,
        prfOutput: wrongPrf,
        userId: 'user-1',
        verifiedSignature: true,
      }),
    ).toThrow()
  })

  test('unwrap refuses without verifiedSignature token', async () => {
    const seed = bytesOf(0xaa)
    const prfOutput = bytesOf(0xbb)
    const keys = deriveSigningKeyPair(bytesOf(0xcc))

    const slot = await buildWrappedKmSlot({
      seed,
      prfOutput,
      userId: 'user-1',
      credentialId: 'cred-abc',
      identitySigningPrivateKey: keys.privateKey,
    })

    expect(() =>
      unwrapKmFromSlot({
        slot,
        prfOutput,
        userId: 'user-1',
        verifiedSignature: false as unknown as true,
      }),
    ).toThrow(/verified/i)
  })
})
