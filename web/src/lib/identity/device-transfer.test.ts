/**
 * Tests for device-to-device recovery transfer primitives.
 */

import { describe, test, expect } from 'vitest'
import {
  generateEphemeralKeypair,
  deriveSAS,
  sealSeedForTransfer,
  openTransferredSeed,
} from './device-transfer'
import { deriveSigningKeyPair } from './federation-crypto'

function bytesOf(byte: number): Uint8Array {
  const s = new Uint8Array(32)
  s.fill(byte)
  return s
}

describe('deriveSAS', () => {
  test('commutative — same result regardless of side', () => {
    const a = generateEphemeralKeypair()
    const b = generateEphemeralKeypair()
    const session = 'sess-1'
    const fromReceiver = deriveSAS(a.publicKey, b.publicKey, session)
    const fromSender = deriveSAS(b.publicKey, a.publicKey, session)
    expect(fromReceiver).toBe(fromSender)
  })

  test('6 digits', () => {
    const a = generateEphemeralKeypair()
    const b = generateEphemeralKeypair()
    const sas = deriveSAS(a.publicKey, b.publicKey, 'sess-1')
    expect(sas).toMatch(/^\d{6}$/)
  })

  test('depends on sessionId — different session → different SAS', () => {
    const a = generateEphemeralKeypair()
    const b = generateEphemeralKeypair()
    const s1 = deriveSAS(a.publicKey, b.publicKey, 'sess-A')
    const s2 = deriveSAS(a.publicKey, b.publicKey, 'sess-B')
    expect(s1).not.toBe(s2)
  })

  test('different keypairs → different SAS', () => {
    const a = generateEphemeralKeypair()
    const b = generateEphemeralKeypair()
    const c = generateEphemeralKeypair()
    const s1 = deriveSAS(a.publicKey, b.publicKey, 'sess-1')
    const s2 = deriveSAS(a.publicKey, c.publicKey, 'sess-1')
    expect(s1).not.toBe(s2)
  })
})

describe('seal + open seed transfer', () => {
  test('round-trips a seed', async () => {
    const seed = bytesOf(0x42)
    const senderEph = generateEphemeralKeypair()
    const receiverEph = generateEphemeralKeypair()
    const identity = deriveSigningKeyPair(bytesOf(0x99))
    const sessionId = 'sess-xyz'

    const payload = await sealSeedForTransfer({
      seed,
      senderEphemeralPrivate: senderEph.privateKey,
      senderEphemeralPublic: senderEph.publicKey,
      receiverEphemeralPublic: receiverEph.publicKey,
      sessionId,
      senderIdentityPrivateKey: identity.privateKey,
    })

    const recovered = openTransferredSeed({
      payload,
      receiverEphemeralPrivate: receiverEph.privateKey,
      receiverEphemeralPublic: receiverEph.publicKey,
      sessionId,
      senderIdentityPublicKey: identity.publicKey,
    })

    expect(Array.from(recovered)).toEqual(Array.from(seed))
  })

  test('wrong sender identity pub fails signature check', async () => {
    const seed = bytesOf(0x42)
    const senderEph = generateEphemeralKeypair()
    const receiverEph = generateEphemeralKeypair()
    const identity = deriveSigningKeyPair(bytesOf(0x99))
    const impostor = deriveSigningKeyPair(bytesOf(0xee))

    const payload = await sealSeedForTransfer({
      seed,
      senderEphemeralPrivate: senderEph.privateKey,
      senderEphemeralPublic: senderEph.publicKey,
      receiverEphemeralPublic: receiverEph.publicKey,
      sessionId: 'sess-xyz',
      senderIdentityPrivateKey: identity.privateKey,
    })

    expect(() =>
      openTransferredSeed({
        payload,
        receiverEphemeralPrivate: receiverEph.privateKey,
        receiverEphemeralPublic: receiverEph.publicKey,
        sessionId: 'sess-xyz',
        senderIdentityPublicKey: impostor.publicKey,
      }),
    ).toThrow(/signature/i)
  })

  test('MITM swapping ephemeral pubs is detected', async () => {
    const seed = bytesOf(0x42)
    const senderEph = generateEphemeralKeypair()
    const attackerEph = generateEphemeralKeypair()
    const receiverEph = generateEphemeralKeypair()
    const identity = deriveSigningKeyPair(bytesOf(0x99))

    // Attacker swaps in their own ephemeral on the wire.
    const payload = await sealSeedForTransfer({
      seed,
      senderEphemeralPrivate: senderEph.privateKey,
      senderEphemeralPublic: senderEph.publicKey,
      receiverEphemeralPublic: receiverEph.publicKey,
      sessionId: 'sess-xyz',
      senderIdentityPrivateKey: identity.privateKey,
    })
    const tampered = {
      ...payload,
      senderEphemeralPub: Buffer.from(attackerEph.publicKey).toString('base64'),
    }

    expect(() =>
      openTransferredSeed({
        payload: tampered,
        receiverEphemeralPrivate: receiverEph.privateKey,
        receiverEphemeralPublic: receiverEph.publicKey,
        sessionId: 'sess-xyz',
        senderIdentityPublicKey: identity.publicKey,
      }),
    ).toThrow(/signature/i)
  })

  test('wrong sessionId fails AAD', async () => {
    const seed = bytesOf(0x42)
    const senderEph = generateEphemeralKeypair()
    const receiverEph = generateEphemeralKeypair()
    const identity = deriveSigningKeyPair(bytesOf(0x99))

    const payload = await sealSeedForTransfer({
      seed,
      senderEphemeralPrivate: senderEph.privateKey,
      senderEphemeralPublic: senderEph.publicKey,
      receiverEphemeralPublic: receiverEph.publicKey,
      sessionId: 'sess-A',
      senderIdentityPrivateKey: identity.privateKey,
    })

    expect(() =>
      openTransferredSeed({
        payload,
        receiverEphemeralPrivate: receiverEph.privateKey,
        receiverEphemeralPublic: receiverEph.publicKey,
        sessionId: 'sess-B',
        senderIdentityPublicKey: identity.publicKey,
      }),
    ).toThrow()
  })
})
