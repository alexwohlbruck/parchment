/**
 * Tests for key-pinning / safety-number derivation.
 *
 * Only covers the pure-function bits (deriveSafetyNumber) since the
 * storage-backed pin ops depend on localStorage + seed and are covered in
 * integration tests.
 */

import { describe, test, expect } from 'vitest'
import { deriveSafetyNumber } from './key-pinning'
import { deriveSigningKeyPair, exportPublicKey } from './federation-crypto'

function seed(byte: number): Uint8Array {
  const s = new Uint8Array(32)
  s.fill(byte)
  return s
}

describe('deriveSafetyNumber', () => {
  test('is commutative: same number regardless of who computes it', () => {
    const alice = exportPublicKey(deriveSigningKeyPair(seed(1)).publicKey)
    const bob = exportPublicKey(deriveSigningKeyPair(seed(2)).publicKey)

    const aliceView = deriveSafetyNumber(alice, bob)
    const bobView = deriveSafetyNumber(bob, alice)
    expect(aliceView).toBe(bobView)
  })

  test('differs across different peers', () => {
    const alice = exportPublicKey(deriveSigningKeyPair(seed(1)).publicKey)
    const bob = exportPublicKey(deriveSigningKeyPair(seed(2)).publicKey)
    const carol = exportPublicKey(deriveSigningKeyPair(seed(3)).publicKey)

    expect(deriveSafetyNumber(alice, bob)).not.toBe(
      deriveSafetyNumber(alice, carol),
    )
  })

  test('formatted as 4 groups of 3 digits', () => {
    const alice = exportPublicKey(deriveSigningKeyPair(seed(1)).publicKey)
    const bob = exportPublicKey(deriveSigningKeyPair(seed(2)).publicKey)

    const number = deriveSafetyNumber(alice, bob)
    expect(number).toMatch(/^\d{3} \d{3} \d{3} \d{3}$/)
  })

  test('changes when one party rotates their key', () => {
    const alice = exportPublicKey(deriveSigningKeyPair(seed(1)).publicKey)
    const bob = exportPublicKey(deriveSigningKeyPair(seed(2)).publicKey)
    const bobRotated = exportPublicKey(deriveSigningKeyPair(seed(42)).publicKey)

    expect(deriveSafetyNumber(alice, bob)).not.toBe(
      deriveSafetyNumber(alice, bobRotated),
    )
  })
})
