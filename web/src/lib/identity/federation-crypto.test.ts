/**
 * Unit tests for frontend cryptographic utilities
 *
 * Tests cover:
 * - Seed generation and key derivation
 * - Ed25519 signing and verification
 * - X25519 key exchange and shared secrets
 * - AES-GCM encryption and decryption
 * - Friend-to-friend E2EE
 * - Location encryption/decryption
 */

import { describe, test, expect, beforeAll } from 'vitest'
import {
  generateSeed,
  deriveSigningKeyPair,
  deriveEncryptionKeyPair,
  deriveAllKeys,
  sign,
  verify,
  deriveSharedSecret,
  exportRecoveryKey,
  importRecoveryKey,
  exportPublicKey,
  importPublicKey,
  buildSignableMessage,
  derivePersonalKey,
  deriveCollectionKey,
  deriveAesKeyFromSharedSecret,
  encrypt,
  decrypt,
  encryptForFriend,
  decryptFromFriend,
  type KeyPair,
} from './federation-crypto'

describe('Seed Generation', () => {
  test('generates 32-byte seed', () => {
    const seed = generateSeed()
    expect(seed).toBeInstanceOf(Uint8Array)
    expect(seed.length).toBe(32)
  })

  test('generates unique seeds', () => {
    const seed1 = generateSeed()
    const seed2 = generateSeed()
    expect(seed1).not.toEqual(seed2)
  })

  test('seed has good entropy (not all zeros or ones)', () => {
    const seed = generateSeed()
    const uniqueBytes = new Set(seed)
    // A random 32-byte seed should have many unique byte values
    expect(uniqueBytes.size).toBeGreaterThan(10)
  })
})

describe('Key Derivation', () => {
  let seed: Uint8Array

  beforeAll(() => {
    seed = generateSeed()
  })

  test('derives signing keypair from seed', () => {
    const keyPair = deriveSigningKeyPair(seed)
    expect(keyPair.privateKey).toBeInstanceOf(Uint8Array)
    expect(keyPair.publicKey).toBeInstanceOf(Uint8Array)
    expect(keyPair.privateKey.length).toBe(32)
    expect(keyPair.publicKey.length).toBe(32)
  })

  test('derives encryption keypair from seed', () => {
    const keyPair = deriveEncryptionKeyPair(seed)
    expect(keyPair.privateKey).toBeInstanceOf(Uint8Array)
    expect(keyPair.publicKey).toBeInstanceOf(Uint8Array)
    expect(keyPair.privateKey.length).toBe(32)
    expect(keyPair.publicKey.length).toBe(32)
  })

  test('signing and encryption keys are different', () => {
    const signing = deriveSigningKeyPair(seed)
    const encryption = deriveEncryptionKeyPair(seed)
    expect(signing.privateKey).not.toEqual(encryption.privateKey)
    expect(signing.publicKey).not.toEqual(encryption.publicKey)
  })

  test('deriveAllKeys returns both keypairs', () => {
    const keys = deriveAllKeys(seed)
    expect(keys.signing).toBeDefined()
    expect(keys.encryption).toBeDefined()
    expect(keys.signing.privateKey.length).toBe(32)
    expect(keys.encryption.privateKey.length).toBe(32)
  })

  test('same seed produces same keys', () => {
    const keys1 = deriveAllKeys(seed)
    const keys2 = deriveAllKeys(seed)
    expect(keys1.signing.privateKey).toEqual(keys2.signing.privateKey)
    expect(keys1.signing.publicKey).toEqual(keys2.signing.publicKey)
    expect(keys1.encryption.privateKey).toEqual(keys2.encryption.privateKey)
    expect(keys1.encryption.publicKey).toEqual(keys2.encryption.publicKey)
  })

  test('different seeds produce different keys', () => {
    const otherSeed = generateSeed()
    const keys1 = deriveAllKeys(seed)
    const keys2 = deriveAllKeys(otherSeed)
    expect(keys1.signing.privateKey).not.toEqual(keys2.signing.privateKey)
    expect(keys1.encryption.privateKey).not.toEqual(keys2.encryption.privateKey)
  })
})

describe('Recovery Key Export/Import', () => {
  test('exports seed as base64 string', () => {
    const seed = generateSeed()
    const recoveryKey = exportRecoveryKey(seed)
    expect(typeof recoveryKey).toBe('string')
    // Base64 of 32 bytes is ~44 characters
    expect(recoveryKey.length).toBe(44)
  })

  test('imports recovery key back to seed', () => {
    const originalSeed = generateSeed()
    const recoveryKey = exportRecoveryKey(originalSeed)
    const importedSeed = importRecoveryKey(recoveryKey)
    expect(importedSeed).toEqual(originalSeed)
  })

  test('throws on invalid recovery key', () => {
    // Short string fails base64 decoding or length check
    expect(() => importRecoveryKey('short')).toThrow()
    // Valid base64 but wrong length (16 bytes)
    expect(() => importRecoveryKey('AAAAAAAAAAAAAAAAAAAAAA==')).toThrow('Invalid recovery key')
  })

  test('handles whitespace in recovery key', () => {
    const seed = generateSeed()
    const recoveryKey = exportRecoveryKey(seed)
    const paddedKey = `  ${recoveryKey}  `
    const importedSeed = importRecoveryKey(paddedKey)
    expect(importedSeed).toEqual(seed)
  })
})

describe('Public Key Export/Import', () => {
  test('exports and imports public key correctly', () => {
    const seed = generateSeed()
    const keyPair = deriveSigningKeyPair(seed)

    const exported = exportPublicKey(keyPair.publicKey)
    expect(typeof exported).toBe('string')

    const imported = importPublicKey(exported)
    expect(imported).toEqual(keyPair.publicKey)
  })
})

describe('Ed25519 Signing and Verification', () => {
  let keyPair: KeyPair

  beforeAll(() => {
    const seed = generateSeed()
    keyPair = deriveSigningKeyPair(seed)
  })

  test('signs and verifies message', async () => {
    const message = 'Hello, world!'
    const signature = await sign(message, keyPair.privateKey)

    expect(typeof signature).toBe('string')
    expect(signature.length).toBeGreaterThan(0)

    const isValid = verify(message, signature, keyPair.publicKey)
    expect(isValid).toBe(true)
  })

  test('verification fails with wrong message', async () => {
    const message = 'Original message'
    const signature = await sign(message, keyPair.privateKey)

    const isValid = verify('Different message', signature, keyPair.publicKey)
    expect(isValid).toBe(false)
  })

  test('verification fails with wrong public key', async () => {
    const message = 'Test message'
    const signature = await sign(message, keyPair.privateKey)

    const differentSeed = generateSeed()
    const differentKeyPair = deriveSigningKeyPair(differentSeed)

    const isValid = verify(message, signature, differentKeyPair.publicKey)
    expect(isValid).toBe(false)
  })

  test('verification fails with corrupted signature', async () => {
    const message = 'Test message'
    const signature = await sign(message, keyPair.privateKey)

    // Corrupt the signature
    const corruptedSignature = signature.slice(0, -2) + 'XX'

    const isValid = verify(message, corruptedSignature, keyPair.publicKey)
    expect(isValid).toBe(false)
  })
})

describe('Signable Message Building', () => {
  test('builds message with sorted keys', () => {
    const payload = { zebra: 'last', alpha: 'first', beta: 'middle' }
    const message = buildSignableMessage('TEST', payload)
    const parsed = JSON.parse(message)

    expect(parsed.type).toBe('TEST')
    expect(parsed.alpha).toBe('first')
    expect(parsed.beta).toBe('middle')
    expect(parsed.zebra).toBe('last')
    
    // Verify keys are present in the stringified message
    expect(message).toContain('"alpha"')
    expect(message).toContain('"type"')
  })

  test('produces consistent output regardless of input order', () => {
    const message1 = buildSignableMessage('TEST', { b: 2, a: 1 })
    const message2 = buildSignableMessage('TEST', { a: 1, b: 2 })
    expect(message1).toBe(message2)
  })
})

describe('X25519 Shared Secret Derivation', () => {
  test('derives same shared secret from both parties', () => {
    const aliceSeed = generateSeed()
    const bobSeed = generateSeed()

    const aliceKeys = deriveEncryptionKeyPair(aliceSeed)
    const bobKeys = deriveEncryptionKeyPair(bobSeed)

    // Alice derives shared secret with Bob's public key
    const aliceShared = deriveSharedSecret(aliceKeys.privateKey, bobKeys.publicKey)

    // Bob derives shared secret with Alice's public key
    const bobShared = deriveSharedSecret(bobKeys.privateKey, aliceKeys.publicKey)

    // Both should be the same
    expect(aliceShared).toEqual(bobShared)
    expect(aliceShared.length).toBe(32)
  })

  test('different key pairs produce different shared secrets', () => {
    const aliceSeed = generateSeed()
    const bobSeed = generateSeed()
    const charlieSeed = generateSeed()

    const aliceKeys = deriveEncryptionKeyPair(aliceSeed)
    const bobKeys = deriveEncryptionKeyPair(bobSeed)
    const charlieKeys = deriveEncryptionKeyPair(charlieSeed)

    const aliceBobShared = deriveSharedSecret(aliceKeys.privateKey, bobKeys.publicKey)
    const aliceCharlieShared = deriveSharedSecret(aliceKeys.privateKey, charlieKeys.publicKey)

    expect(aliceBobShared).not.toEqual(aliceCharlieShared)
  })
})

describe('AES Key Derivation', () => {
  test('derives personal key from seed', () => {
    const seed = generateSeed()
    const personalKey = derivePersonalKey(seed)
    expect(personalKey).toBeInstanceOf(Uint8Array)
    expect(personalKey.length).toBe(32)
  })

  test('derives collection key with collection ID', () => {
    const seed = generateSeed()
    const collectionKey1 = deriveCollectionKey(seed, 'collection-1')
    const collectionKey2 = deriveCollectionKey(seed, 'collection-2')

    expect(collectionKey1.length).toBe(32)
    expect(collectionKey2.length).toBe(32)
    expect(collectionKey1).not.toEqual(collectionKey2)
  })

  test('derives AES key from shared secret', () => {
    const aliceSeed = generateSeed()
    const bobSeed = generateSeed()

    const aliceKeys = deriveEncryptionKeyPair(aliceSeed)
    const bobKeys = deriveEncryptionKeyPair(bobSeed)

    const sharedSecret = deriveSharedSecret(aliceKeys.privateKey, bobKeys.publicKey)
    const aesKey = deriveAesKeyFromSharedSecret(sharedSecret)

    expect(aesKey.length).toBe(32)
  })

  test('different contexts produce different AES keys', () => {
    const aliceSeed = generateSeed()
    const bobSeed = generateSeed()

    const aliceKeys = deriveEncryptionKeyPair(aliceSeed)
    const bobKeys = deriveEncryptionKeyPair(bobSeed)

    const sharedSecret = deriveSharedSecret(aliceKeys.privateKey, bobKeys.publicKey)
    const aesKey1 = deriveAesKeyFromSharedSecret(sharedSecret, 'context-1')
    const aesKey2 = deriveAesKeyFromSharedSecret(sharedSecret, 'context-2')

    expect(aesKey1).not.toEqual(aesKey2)
  })
})

describe('AES-GCM Encryption and Decryption', () => {
  test('encrypts and decrypts string data', () => {
    const key = derivePersonalKey(generateSeed())
    const plaintext = 'Hello, encrypted world!'

    const encrypted = encrypt(plaintext, key)
    expect(encrypted.ciphertext).toBeTruthy()
    expect(encrypted.nonce).toBeTruthy()
    expect(encrypted.ciphertext).not.toBe(plaintext)

    const decrypted = decrypt(encrypted.ciphertext, encrypted.nonce, key)
    expect(decrypted).toBe(plaintext)
  })

  test('decryption fails with wrong key', () => {
    const key1 = derivePersonalKey(generateSeed())
    const key2 = derivePersonalKey(generateSeed())
    const plaintext = 'Secret message'

    const encrypted = encrypt(plaintext, key1)

    expect(() => decrypt(encrypted.ciphertext, encrypted.nonce, key2)).toThrow()
  })

  test('decryption fails with wrong nonce', () => {
    const key = derivePersonalKey(generateSeed())
    const plaintext = 'Secret message'

    const encrypted = encrypt(plaintext, key)
    const wrongEncrypted = encrypt('different', key)

    expect(() => decrypt(encrypted.ciphertext, wrongEncrypted.nonce, key)).toThrow()
  })

  test('different nonces produce different ciphertexts', () => {
    const key = derivePersonalKey(generateSeed())
    const plaintext = 'Same message'

    const encrypted1 = encrypt(plaintext, key)
    const encrypted2 = encrypt(plaintext, key)

    expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext)
    expect(encrypted1.nonce).not.toBe(encrypted2.nonce)
  })

  test('handles empty string', () => {
    const key = derivePersonalKey(generateSeed())
    const plaintext = ''

    const encrypted = encrypt(plaintext, key)
    const decrypted = decrypt(encrypted.ciphertext, encrypted.nonce, key)

    expect(decrypted).toBe('')
  })

  test('handles unicode characters', () => {
    const key = derivePersonalKey(generateSeed())
    const plaintext = '你好世界 🌍 Привет мир'

    const encrypted = encrypt(plaintext, key)
    const decrypted = decrypt(encrypted.ciphertext, encrypted.nonce, key)

    expect(decrypted).toBe(plaintext)
  })

  test('handles long strings', () => {
    const key = derivePersonalKey(generateSeed())
    const plaintext = 'A'.repeat(10000)

    const encrypted = encrypt(plaintext, key)
    const decrypted = decrypt(encrypted.ciphertext, encrypted.nonce, key)

    expect(decrypted).toBe(plaintext)
  })
})

describe('Friend-to-Friend E2EE', () => {
  let aliceEncryption: KeyPair
  let bobEncryption: KeyPair

  beforeAll(() => {
    const aliceSeed = generateSeed()
    const bobSeed = generateSeed()
    aliceEncryption = deriveEncryptionKeyPair(aliceSeed)
    bobEncryption = deriveEncryptionKeyPair(bobSeed)
  })

  test('Alice encrypts, Bob decrypts', () => {
    const message = 'Hello Bob!'

    // Alice encrypts for Bob
    const encrypted = encryptForFriend(
      message,
      aliceEncryption.privateKey,
      bobEncryption.publicKey,
    )

    // Bob decrypts from Alice
    const decrypted = decryptFromFriend(
      encrypted.ciphertext,
      encrypted.nonce,
      bobEncryption.privateKey,
      aliceEncryption.publicKey,
    )

    expect(decrypted).toBe(message)
  })

  test('Bob encrypts, Alice decrypts', () => {
    const message = 'Hello Alice!'

    // Bob encrypts for Alice
    const encrypted = encryptForFriend(
      message,
      bobEncryption.privateKey,
      aliceEncryption.publicKey,
    )

    // Alice decrypts from Bob
    const decrypted = decryptFromFriend(
      encrypted.ciphertext,
      encrypted.nonce,
      aliceEncryption.privateKey,
      bobEncryption.publicKey,
    )

    expect(decrypted).toBe(message)
  })

  test('third party cannot decrypt', () => {
    const charlieSeed = generateSeed()
    const charlieEncryption = deriveEncryptionKeyPair(charlieSeed)

    const message = 'Private message'
    const encrypted = encryptForFriend(
      message,
      aliceEncryption.privateKey,
      bobEncryption.publicKey,
    )

    // Charlie tries to decrypt with Bob's public key
    expect(() =>
      decryptFromFriend(
        encrypted.ciphertext,
        encrypted.nonce,
        charlieEncryption.privateKey,
        bobEncryption.publicKey,
      ),
    ).toThrow()
  })

  test('different context prevents decryption', () => {
    const message = 'Context-specific message'

    // Alice encrypts with custom context
    const encrypted = encryptForFriend(
      message,
      aliceEncryption.privateKey,
      bobEncryption.publicKey,
      'custom-context',
    )

    // Bob tries to decrypt with default context
    expect(() =>
      decryptFromFriend(
        encrypted.ciphertext,
        encrypted.nonce,
        bobEncryption.privateKey,
        aliceEncryption.publicKey,
        // Default context is different
      ),
    ).toThrow()

    // Bob decrypts with correct context
    const decrypted = decryptFromFriend(
      encrypted.ciphertext,
      encrypted.nonce,
      bobEncryption.privateKey,
      aliceEncryption.publicKey,
      'custom-context',
    )
    expect(decrypted).toBe(message)
  })
})

describe('End-to-End Federation Workflow', () => {
  test('complete friend invite signing and verification flow', async () => {
    // Alice creates identity
    const aliceSeed = generateSeed()
    const aliceKeys = deriveAllKeys(aliceSeed)
    const aliceHandle = 'alice@parchment.app'

    // Bob creates identity
    const bobSeed = generateSeed()
    const bobKeys = deriveAllKeys(bobSeed)
    const bobHandle = 'bob@other.server'

    // Alice sends friend invite to Bob
    const invitePayload = {
      from: aliceHandle,
      to: bobHandle,
      timestamp: new Date().toISOString(),
    }

    const signableMessage = buildSignableMessage('FRIEND_INVITE', invitePayload)
    const signature = await sign(signableMessage, aliceKeys.signing.privateKey)

    // Bob's server receives the invite and verifies
    const isValidSignature = verify(
      signableMessage,
      signature,
      aliceKeys.signing.publicKey,
    )
    expect(isValidSignature).toBe(true)

    // Bob accepts and sends acceptance
    const acceptPayload = {
      from: bobHandle,
      to: aliceHandle,
      timestamp: new Date().toISOString(),
    }

    const acceptMessage = buildSignableMessage('FRIEND_ACCEPT', acceptPayload)
    const acceptSignature = await sign(acceptMessage, bobKeys.signing.privateKey)

    // Alice's server verifies acceptance
    const isValidAccept = verify(
      acceptMessage,
      acceptSignature,
      bobKeys.signing.publicKey,
    )
    expect(isValidAccept).toBe(true)

    // Now they can share encrypted data
    const secretMessage = 'Our friendship is E2E encrypted!'
    const encrypted = encryptForFriend(
      secretMessage,
      aliceKeys.encryption.privateKey,
      bobKeys.encryption.publicKey,
    )

    const decrypted = decryptFromFriend(
      encrypted.ciphertext,
      encrypted.nonce,
      bobKeys.encryption.privateKey,
      aliceKeys.encryption.publicKey,
    )

    expect(decrypted).toBe(secretMessage)
  })

  // Location sharing end-to-end tests moved to federation-crypto-ecies.test.ts,
  // which covers the v2 ECIES encrypt/decrypt path that actually ships.
})
