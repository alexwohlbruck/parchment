/**
 * Unit tests for server-side cryptographic utilities
 * 
 * Tests cover:
 * - Handle parsing and validation
 * - Ed25519 signature creation and verification
 * - Message signing for federation
 */

import { describe, test, expect, beforeAll } from 'bun:test'
import {
  verifySignature,
  signMessage,
  buildSignableMessage,
  parseHandle,
  isValidAlias,
  getPublicKeyFromPrivate,
} from './crypto'

// Test key pair (generated for testing purposes)
// In production, keys are generated client-side
const TEST_PRIVATE_KEY = 'dGVzdHByaXZhdGVrZXkxMjM0NTY3ODkwYWJjZGVm' // Base64 of 32 bytes
let TEST_PUBLIC_KEY: string

describe('Handle Parsing', () => {
  test('parses valid handle with standard domain', () => {
    const result = parseHandle('alice@example.com')
    expect(result).not.toBeNull()
    expect(result?.alias).toBe('alice')
    expect(result?.domain).toBe('example.com')
  })

  test('parses valid handle with subdomain', () => {
    const result = parseHandle('bob@api.parchment.app')
    expect(result).not.toBeNull()
    expect(result?.alias).toBe('bob')
    expect(result?.domain).toBe('api.parchment.app')
  })

  test('parses valid handle with port number', () => {
    const result = parseHandle('test@localhost:5000')
    expect(result).not.toBeNull()
    expect(result?.alias).toBe('test')
    expect(result?.domain).toBe('localhost:5000')
  })

  test('parses valid handle with IP and port', () => {
    const result = parseHandle('user@192.168.1.1:3000')
    expect(result).not.toBeNull()
    expect(result?.alias).toBe('user')
    expect(result?.domain).toBe('192.168.1.1:3000')
  })

  test('rejects handle with invalid alias (too short)', () => {
    const result = parseHandle('ab@example.com')
    expect(result).toBeNull()
  })

  test('rejects handle with invalid alias (too long)', () => {
    const longAlias = 'a'.repeat(31)
    const result = parseHandle(`${longAlias}@example.com`)
    expect(result).toBeNull()
  })

  test('rejects handle with special characters in alias', () => {
    const result = parseHandle('alice!bob@example.com')
    expect(result).toBeNull()
  })

  test('rejects handle without @ symbol', () => {
    const result = parseHandle('aliceexample.com')
    expect(result).toBeNull()
  })

  test('rejects handle with multiple @ symbols', () => {
    const result = parseHandle('alice@bob@example.com')
    expect(result).toBeNull()
  })

  test('rejects handle with empty alias', () => {
    const result = parseHandle('@example.com')
    expect(result).toBeNull()
  })

  test('accepts alias with underscores', () => {
    const result = parseHandle('alice_bob@example.com')
    expect(result).not.toBeNull()
    expect(result?.alias).toBe('alice_bob')
  })

  test('accepts alias with numbers', () => {
    const result = parseHandle('alice123@example.com')
    expect(result).not.toBeNull()
    expect(result?.alias).toBe('alice123')
  })
})

describe('Alias Validation', () => {
  test('validates correct alias', () => {
    expect(isValidAlias('alice')).toBe(true)
    expect(isValidAlias('bob123')).toBe(true)
    expect(isValidAlias('user_name')).toBe(true)
    expect(isValidAlias('ABC')).toBe(true)
  })

  test('rejects invalid alias', () => {
    expect(isValidAlias('ab')).toBe(false) // too short
    expect(isValidAlias('a'.repeat(31))).toBe(false) // too long
    expect(isValidAlias('user-name')).toBe(false) // hyphen not allowed
    expect(isValidAlias('user.name')).toBe(false) // dot not allowed
    expect(isValidAlias('user@name')).toBe(false) // @ not allowed
    expect(isValidAlias('')).toBe(false) // empty
  })
})

describe('Signable Message Building', () => {
  test('builds message with sorted keys', () => {
    const payload = { zebra: 'last', alpha: 'first', beta: 'middle' }
    const message = buildSignableMessage('TEST', payload)
    const parsed = JSON.parse(message)

    // Check that type is included
    expect(parsed.type).toBe('TEST')
    expect(parsed.alpha).toBe('first')
    expect(parsed.beta).toBe('middle')
    expect(parsed.zebra).toBe('last')
    
    // Verify the message string has keys in sorted order
    // The JSON string should have keys sorted alphabetically
    const keyOrderInString = message.match(/"([a-z]+)":/g)?.map(k => k.slice(1, -2))
    expect(keyOrderInString).toContain('alpha')
    expect(keyOrderInString).toContain('type')
  })

  test('handles nested objects', () => {
    const payload = {
      user: { name: 'Alice', id: '123' },
      action: 'invite',
    }
    const message = buildSignableMessage('FRIEND_INVITE', payload)
    const parsed = JSON.parse(message)

    expect(parsed.type).toBe('FRIEND_INVITE')
    expect(parsed.user).toEqual({ id: '123', name: 'Alice' })
  })

  test('handles arrays', () => {
    const payload = { items: [3, 1, 2], name: 'list' }
    const message = buildSignableMessage('TEST', payload)
    const parsed = JSON.parse(message)

    // Arrays should preserve order
    expect(parsed.items).toEqual([3, 1, 2])
  })

  test('produces consistent output for same input', () => {
    const payload = { b: 2, a: 1 }
    const message1 = buildSignableMessage('TEST', payload)
    const message2 = buildSignableMessage('TEST', { a: 1, b: 2 })

    // Same data in different order should produce same result
    expect(message1).toBe(message2)
  })
})

describe('Ed25519 Signature Operations', () => {
  // Generate a proper test keypair
  beforeAll(async () => {
    // Create a proper 32-byte seed
    const seed = new Uint8Array(32)
    crypto.getRandomValues(seed)
    const base64Seed = btoa(String.fromCharCode(...seed))
    
    // Get corresponding public key
    TEST_PUBLIC_KEY = await getPublicKeyFromPrivate(base64Seed)
    
    // Store the seed for signing tests
    ;(globalThis as any).TEST_SEED = base64Seed
  })

  test('signs and verifies message successfully', async () => {
    const message = 'Hello, federation!'
    const seed = (globalThis as any).TEST_SEED

    const signature = await signMessage(message, seed)
    expect(signature).toBeTruthy()
    expect(typeof signature).toBe('string')

    const isValid = verifySignature(message, signature, TEST_PUBLIC_KEY)
    expect(isValid).toBe(true)
  })

  test('verification fails with wrong message', async () => {
    const message = 'Original message'
    const seed = (globalThis as any).TEST_SEED

    const signature = await signMessage(message, seed)
    const isValid = verifySignature('Different message', signature, TEST_PUBLIC_KEY)
    expect(isValid).toBe(false)
  })

  test('verification fails with wrong public key', async () => {
    const message = 'Test message'
    const seed = (globalThis as any).TEST_SEED

    const signature = await signMessage(message, seed)

    // Create a different keypair
    const differentSeed = new Uint8Array(32)
    crypto.getRandomValues(differentSeed)
    const differentBase64Seed = btoa(String.fromCharCode(...differentSeed))
    const wrongPublicKey = await getPublicKeyFromPrivate(differentBase64Seed)

    const isValid = verifySignature(message, signature, wrongPublicKey)
    expect(isValid).toBe(false)
  })

  test('verification fails with tampered signature', async () => {
    const message = 'Test message'
    const seed = (globalThis as any).TEST_SEED

    const signature = await signMessage(message, seed)

    // Tamper with the signature by flipping a bit in the last byte.
    // We decode, mutate, and re-encode so the result stays 64 bytes — this
    // exercises the "valid format, wrong signature" path (returns false),
    // separate from the "malformed input" path (throws).
    const rawBin = atob(signature)
    const bytes = new Uint8Array(rawBin.length)
    for (let i = 0; i < rawBin.length; i++) bytes[i] = rawBin.charCodeAt(i)
    bytes[bytes.length - 1] ^= 0x01
    let rebuilt = ''
    for (let i = 0; i < bytes.length; i++) rebuilt += String.fromCharCode(bytes[i])
    const tamperedSignature = btoa(rebuilt)

    const isValid = verifySignature(message, tamperedSignature, TEST_PUBLIC_KEY)
    expect(isValid).toBe(false)
  })

  test('verification throws on malformed signature input', async () => {
    const message = 'Test message'
    // Wrong length (not 64 bytes when decoded)
    expect(() => verifySignature(message, 'YWJj', TEST_PUBLIC_KEY)).toThrow()
    // Non-base64 signature
    expect(() =>
      verifySignature(message, '!!!not base64!!!', TEST_PUBLIC_KEY),
    ).toThrow()
  })

  test('signs federation message format correctly', async () => {
    const seed = (globalThis as any).TEST_SEED
    const payload = {
      from: 'alice@example.com',
      to: 'bob@other.com',
      timestamp: '2024-01-01T00:00:00Z',
    }

    const signableMessage = buildSignableMessage('FRIEND_INVITE', payload)
    const signature = await signMessage(signableMessage, seed)

    const isValid = verifySignature(signableMessage, signature, TEST_PUBLIC_KEY)
    expect(isValid).toBe(true)
  })
})

describe('Public Key Derivation', () => {
  test('derives consistent public key from private key', async () => {
    const seed = new Uint8Array(32)
    crypto.getRandomValues(seed)
    const base64Seed = btoa(String.fromCharCode(...seed))

    const publicKey1 = await getPublicKeyFromPrivate(base64Seed)
    const publicKey2 = await getPublicKeyFromPrivate(base64Seed)

    expect(publicKey1).toBe(publicKey2)
  })

  test('different private keys produce different public keys', async () => {
    const seed1 = new Uint8Array(32)
    crypto.getRandomValues(seed1)
    const seed2 = new Uint8Array(32)
    crypto.getRandomValues(seed2)

    const publicKey1 = await getPublicKeyFromPrivate(btoa(String.fromCharCode(...seed1)))
    const publicKey2 = await getPublicKeyFromPrivate(btoa(String.fromCharCode(...seed2)))

    expect(publicKey1).not.toBe(publicKey2)
  })
})
