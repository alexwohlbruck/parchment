/**
 * Tests for the integration-credential KMS wrapper.
 *
 * Round-trip correctness, tamper detection, and key-version gating.
 * We can't unit-test the "prod must have env var" branch without mutating
 * NODE_ENV — done via a single explicit test below.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  encryptIntegrationConfig,
  decryptIntegrationConfig,
  getCurrentKeyVersion,
  integrationKmsInternals,
} from './integration-kms'

const originalKey = process.env.PARCHMENT_INTEGRATION_KMS_KEY
const originalNodeEnv = process.env.NODE_ENV

beforeEach(() => {
  integrationKmsInternals.resetCache()
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.PARCHMENT_INTEGRATION_KMS_KEY
  else process.env.PARCHMENT_INTEGRATION_KMS_KEY = originalKey
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  integrationKmsInternals.resetCache()
})

function setTestKey() {
  // 32 bytes of 0x42.
  const key = Buffer.alloc(32, 0x42).toString('base64')
  process.env.PARCHMENT_INTEGRATION_KMS_KEY = key
}

describe('integration-kms', () => {
  test('round-trips a config object', () => {
    setTestKey()
    const config = {
      apiKey: 'sk_live_abcdef123',
      host: 'https://api.example.com',
    }
    const blob = encryptIntegrationConfig(config)
    expect(blob.keyVersion).toBe(getCurrentKeyVersion())
    const out = decryptIntegrationConfig(blob)
    expect(out).toEqual(config)
  })

  test('two encrypts of the same config produce different ciphertexts', () => {
    setTestKey()
    const a = encryptIntegrationConfig({ apiKey: 'x' })
    const b = encryptIntegrationConfig({ apiKey: 'x' })
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(a.nonce).not.toBe(b.nonce)
  })

  test('tampered ciphertext throws', () => {
    setTestKey()
    const blob = encryptIntegrationConfig({ apiKey: 'secret' })
    // Flip a bit in the base64 ciphertext.
    const bytes = Buffer.from(blob.ciphertext, 'base64')
    bytes[bytes.length - 3] ^= 0x01
    const tampered = { ...blob, ciphertext: bytes.toString('base64') }
    expect(() => decryptIntegrationConfig(tampered)).toThrow()
  })

  test('tampered nonce throws', () => {
    setTestKey()
    const blob = encryptIntegrationConfig({ apiKey: 'secret' })
    const bytes = Buffer.from(blob.nonce, 'base64')
    bytes[0] ^= 0x01
    const tampered = { ...blob, nonce: bytes.toString('base64') }
    expect(() => decryptIntegrationConfig(tampered)).toThrow()
  })

  test('wrong key throws', () => {
    setTestKey()
    const blob = encryptIntegrationConfig({ apiKey: 'secret' })

    // Swap in a different key and try to decrypt.
    process.env.PARCHMENT_INTEGRATION_KMS_KEY = Buffer.alloc(32, 0x99).toString(
      'base64',
    )
    integrationKmsInternals.resetCache()

    expect(() => decryptIntegrationConfig(blob)).toThrow()
  })

  test('rejects unsupported keyVersion', () => {
    setTestKey()
    const blob = encryptIntegrationConfig({ apiKey: 'x' })
    expect(() =>
      decryptIntegrationConfig({ ...blob, keyVersion: 99 }),
    ).toThrow(/keyVersion/)
  })

  test('rejects a wrong-length env key', () => {
    process.env.PARCHMENT_INTEGRATION_KMS_KEY = Buffer.alloc(16, 0).toString(
      'base64',
    )
    integrationKmsInternals.resetCache()
    expect(() => encryptIntegrationConfig({ x: 1 })).toThrow(/32-byte/)
  })

  test('production requires env key', () => {
    delete process.env.PARCHMENT_INTEGRATION_KMS_KEY
    process.env.NODE_ENV = 'production'
    integrationKmsInternals.resetCache()
    expect(() => encryptIntegrationConfig({ x: 1 })).toThrow(
      /required in production/,
    )
  })

  test('dev generates an ephemeral key with warning', () => {
    delete process.env.PARCHMENT_INTEGRATION_KMS_KEY
    process.env.NODE_ENV = 'development'
    integrationKmsInternals.resetCache()
    // Should not throw; generates an in-memory key.
    const blob = encryptIntegrationConfig({ x: 1 })
    expect(decryptIntegrationConfig(blob)).toEqual({ x: 1 })
  })
})
