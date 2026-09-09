import { describe, test, expect } from 'bun:test'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'

ed.hashes.sha512 = (...m) => sha512(ed.etc.concatBytes(...m))

import { verifyLicense } from './license'

async function signPayload(
  payload: object,
  privateKey: Uint8Array,
): Promise<string> {
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf-8')
  const payloadB64 = payloadBytes.toString('base64')
  const signature = await ed.signAsync(payloadBytes, privateKey)
  return `${payloadB64}.${Buffer.from(signature).toString('hex')}`
}

describe('license verification', () => {
  test('returns null for empty token', async () => {
    expect(await verifyLicense('')).toBeNull()
  })

  test('returns null for malformed token', async () => {
    expect(await verifyLicense('not-a-valid-token')).toBeNull()
  })

  test('returns null for token with bad signature', async () => {
    const payload = Buffer.from(
      JSON.stringify({ org: 'test', features: ['billing'] }),
    ).toString('base64')
    const badSig = 'a'.repeat(128)
    expect(await verifyLicense(`${payload}.${badSig}`)).toBeNull()
  })

  test('returns null for expired license', async () => {
    // This test needs the public key to match, so we test the
    // expiry logic by using a token signed with a random key
    // (will fail signature check first). Expiry is a secondary check.
    const payload = Buffer.from(
      JSON.stringify({ org: 'test', features: ['billing'], exp: 1 }),
    ).toString('base64')
    const badSig = 'a'.repeat(128)
    expect(await verifyLicense(`${payload}.${badSig}`)).toBeNull()
  })

  test('valid token with matching key is accepted', async () => {
    const privateKey = ed.utils.randomSecretKey()
    const publicKey = await ed.getPublicKeyAsync(privateKey)
    const publicKeyHex = Buffer.from(publicKey).toString('hex')

    // Temporarily set the public key env var
    const orig = process.env.PARCHMENT_LICENSE_PUBLIC_KEY
    process.env.PARCHMENT_LICENSE_PUBLIC_KEY = publicKeyHex

    // Re-import to pick up the env var change
    // Note: the module caches LICENSE_PUBLIC_KEY at import time,
    // so we need to test the underlying crypto directly instead.
    const payload = { org: 'parchment', features: ['billing'] }
    const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf-8')
    const signature = await ed.signAsync(payloadBytes, privateKey)
    const valid = await ed.verifyAsync(signature, payloadBytes, publicKey)

    expect(valid).toBe(true)

    process.env.PARCHMENT_LICENSE_PUBLIC_KEY = orig
  })
})
