/**
 * Federation Cryptography Utilities
 *
 * Provides Ed25519 signing and X25519 encryption key derivation from a single seed.
 * Uses @noble/ed25519 and @noble/curves for cryptographic operations.
 */

import * as ed from '@noble/ed25519'
import { x25519 } from '@noble/curves/ed25519.js'
import { sha512, sha256 } from '@noble/hashes/sha2.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { gcm } from '@noble/ciphers/aes.js'
import { randomBytes } from '@noble/ciphers/utils.js'

// Configure ed25519 to use sha512
ed.hashes.sha512 = (...m) => sha512(ed.etc.concatBytes(...m))

export interface KeyPair {
  publicKey: Uint8Array
  privateKey: Uint8Array
}

export interface DerivedKeys {
  signing: KeyPair
  encryption: KeyPair
}

/**
 * Generate a cryptographically secure 32-byte seed
 * This is the recovery key that users save to their password manager
 */
export function generateSeed(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

/**
 * Derive an Ed25519 signing keypair from a seed
 * @param seed - 32-byte seed
 * @returns Ed25519 keypair
 */
export function deriveSigningKeyPair(seed: Uint8Array): KeyPair {
  // Use HKDF to derive signing key material from seed
  const signingMaterial = hkdf(
    sha256,
    seed,
    undefined,
    new TextEncoder().encode('parchment-signing-v1'),
    32,
  )
  const publicKey = ed.getPublicKey(signingMaterial)

  return {
    privateKey: signingMaterial,
    publicKey,
  }
}

/**
 * Derive an X25519 encryption keypair from a seed
 * @param seed - 32-byte seed
 * @returns X25519 keypair
 */
export function deriveEncryptionKeyPair(seed: Uint8Array): KeyPair {
  // Use HKDF to derive encryption key material from seed
  // Use different info string to get different key
  const encryptionMaterial = hkdf(
    sha256,
    seed,
    undefined,
    new TextEncoder().encode('parchment-encryption-v1'),
    32,
  )
  const publicKey = x25519.getPublicKey(encryptionMaterial)

  return {
    privateKey: encryptionMaterial,
    publicKey,
  }
}

/**
 * Derive both signing and encryption keypairs from a single seed
 * @param seed - 32-byte seed
 * @returns Both keypairs
 */
export function deriveAllKeys(seed: Uint8Array): DerivedKeys {
  return {
    signing: deriveSigningKeyPair(seed),
    encryption: deriveEncryptionKeyPair(seed),
  }
}

/**
 * Sign a message with an Ed25519 private key
 * @param message - Message string to sign
 * @param privateKey - Ed25519 private key (32 bytes)
 * @returns Base64-encoded signature
 */
export async function sign(
  message: string,
  privateKey: Uint8Array,
): Promise<string> {
  const messageBytes = new TextEncoder().encode(message)
  const signature = await ed.signAsync(messageBytes, privateKey)
  return bytesToBase64(signature)
}

/**
 * Verify an Ed25519 signature
 * @param message - Original message
 * @param signature - Base64-encoded signature
 * @param publicKey - Ed25519 public key
 * @returns true if valid
 */
export function verify(
  message: string,
  signature: string,
  publicKey: Uint8Array,
): boolean {
  try {
    const messageBytes = new TextEncoder().encode(message)
    const signatureBytes = base64ToBytes(signature)
    return ed.verify(signatureBytes, messageBytes, publicKey)
  } catch {
    return false
  }
}

/**
 * Derive a shared secret using X25519 ECDH
 * Used for E2E encryption between two users
 * @param myPrivateKey - Your X25519 private key
 * @param theirPublicKey - Their X25519 public key
 * @returns 32-byte shared secret
 */
export function deriveSharedSecret(
  myPrivateKey: Uint8Array,
  theirPublicKey: Uint8Array,
): Uint8Array {
  return x25519.getSharedSecret(myPrivateKey, theirPublicKey)
}

/**
 * Export seed as a recovery key string (base64)
 * @param seed - 32-byte seed
 * @returns Base64-encoded recovery key (~44 characters)
 */
export function exportRecoveryKey(seed: Uint8Array): string {
  return bytesToBase64(seed)
}

/**
 * Import seed from a recovery key string
 * @param recoveryKey - Base64-encoded recovery key
 * @returns 32-byte seed
 * @throws Error if invalid format
 */
export function importRecoveryKey(recoveryKey: string): Uint8Array {
  const seed = base64ToBytes(recoveryKey.trim())
  if (seed.length !== 32) {
    throw new Error('Invalid recovery key: must be 32 bytes')
  }
  return seed
}

/**
 * Export a public key as base64 string
 */
export function exportPublicKey(publicKey: Uint8Array): string {
  return bytesToBase64(publicKey)
}

/**
 * Import a public key from base64 string
 */
export function importPublicKey(base64Key: string): Uint8Array {
  return base64ToBytes(base64Key)
}

/**
 * Build a canonical message string for signing
 * Ensures consistent format for signature verification
 */
export function buildSignableMessage(
  type: string,
  payload: Record<string, unknown>,
): string {
  const sortedPayload = sortObjectKeys(payload) as Record<string, unknown>
  return JSON.stringify({
    type,
    ...sortedPayload,
  })
}

// ============================================================================
// Key Derivation for E2EE
// ============================================================================

/**
 * Derive a personal encryption key from the user's seed
 * Used for encrypting personal data like location history
 * @param seed - 32-byte user seed
 * @returns 32-byte AES key
 */
export function derivePersonalKey(seed: Uint8Array): Uint8Array {
  return hkdf(
    sha256,
    seed,
    undefined,
    new TextEncoder().encode('parchment-personal-v1'),
    32,
  )
}

/**
 * Derive a collection-specific encryption key
 * Each collection gets a unique key derived from the user's seed + collection ID
 * @param seed - 32-byte user seed
 * @param collectionId - Unique collection identifier
 * @returns 32-byte AES key
 */
export function deriveCollectionKey(
  seed: Uint8Array,
  collectionId: string,
): Uint8Array {
  return hkdf(
    sha256,
    seed,
    undefined,
    new TextEncoder().encode(`parchment-collection-${collectionId}`),
    32,
  )
}

/**
 * Derive an AES key from a shared secret (for friend-to-friend encryption)
 * @param sharedSecret - 32-byte X25519 shared secret
 * @param context - Optional context string for key separation
 * @returns 32-byte AES key
 */
export function deriveAesKeyFromSharedSecret(
  sharedSecret: Uint8Array,
  context: string = 'parchment-share-v1',
): Uint8Array {
  return hkdf(
    sha256,
    sharedSecret,
    undefined,
    new TextEncoder().encode(context),
    32,
  )
}

// ============================================================================
// AES-GCM Encryption/Decryption
// ============================================================================

export interface EncryptedData {
  ciphertext: string // Base64-encoded ciphertext
  nonce: string // Base64-encoded 12-byte nonce
}

/**
 * Encrypt plaintext using AES-256-GCM
 * @param plaintext - String to encrypt
 * @param key - 32-byte AES key
 * @returns Encrypted data with ciphertext and nonce
 */
export function encrypt(plaintext: string, key: Uint8Array): EncryptedData {
  const nonce = randomBytes(12)
  const plaintextBytes = new TextEncoder().encode(plaintext)
  const cipher = gcm(key, nonce)
  const ciphertext = cipher.encrypt(plaintextBytes)

  return {
    ciphertext: bytesToBase64(ciphertext),
    nonce: bytesToBase64(nonce),
  }
}

/**
 * Decrypt ciphertext using AES-256-GCM
 * @param ciphertext - Base64-encoded ciphertext
 * @param nonce - Base64-encoded 12-byte nonce
 * @param key - 32-byte AES key
 * @returns Decrypted plaintext
 * @throws Error if decryption fails (wrong key or tampered data)
 */
export function decrypt(
  ciphertext: string,
  nonce: string,
  key: Uint8Array,
): string {
  const ciphertextBytes = base64ToBytes(ciphertext)
  const nonceBytes = base64ToBytes(nonce)
  const cipher = gcm(key, nonceBytes)
  const plaintextBytes = cipher.decrypt(ciphertextBytes)

  return new TextDecoder().decode(plaintextBytes)
}

/**
 * Encrypt data for a specific friend using X25519 key exchange
 * @param plaintext - String to encrypt
 * @param myEncryptionPrivateKey - Your X25519 private key
 * @param friendEncryptionPublicKey - Friend's X25519 public key
 * @param context - Optional context for key derivation
 * @returns Encrypted data
 */
export function encryptForFriend(
  plaintext: string,
  myEncryptionPrivateKey: Uint8Array,
  friendEncryptionPublicKey: Uint8Array,
  context: string = 'parchment-share-v1',
): EncryptedData {
  const sharedSecret = deriveSharedSecret(
    myEncryptionPrivateKey,
    friendEncryptionPublicKey,
  )
  const aesKey = deriveAesKeyFromSharedSecret(sharedSecret, context)
  return encrypt(plaintext, aesKey)
}

/**
 * Decrypt data from a friend using X25519 key exchange
 * @param ciphertext - Base64-encoded ciphertext
 * @param nonce - Base64-encoded nonce
 * @param myEncryptionPrivateKey - Your X25519 private key
 * @param friendEncryptionPublicKey - Friend's X25519 public key
 * @param context - Optional context for key derivation (must match encryption)
 * @returns Decrypted plaintext
 */
export function decryptFromFriend(
  ciphertext: string,
  nonce: string,
  myEncryptionPrivateKey: Uint8Array,
  friendEncryptionPublicKey: Uint8Array,
  context: string = 'parchment-share-v1',
): string {
  const sharedSecret = deriveSharedSecret(
    myEncryptionPrivateKey,
    friendEncryptionPublicKey,
  )
  const aesKey = deriveAesKeyFromSharedSecret(sharedSecret, context)
  return decrypt(ciphertext, nonce, aesKey)
}

// ============================================================================
// Location-specific encryption helpers
// ============================================================================

export interface LocationData {
  lat: number
  lng: number
  accuracy?: number
  altitude?: number
  speed?: number
  heading?: number
  timestamp: number
}

/**
 * Encrypt location data with personal key (for location history)
 * @param location - Location data object
 * @param personalKey - 32-byte personal encryption key
 * @returns Encrypted data
 */
export function encryptLocation(
  location: LocationData,
  personalKey: Uint8Array,
): EncryptedData {
  return encrypt(JSON.stringify(location), personalKey)
}

/**
 * Decrypt location data
 * @param ciphertext - Base64-encoded ciphertext
 * @param nonce - Base64-encoded nonce
 * @param key - 32-byte encryption key
 * @returns Decrypted location data
 */
export function decryptLocation(
  ciphertext: string,
  nonce: string,
  key: Uint8Array,
): LocationData {
  const plaintext = decrypt(ciphertext, nonce, key)
  return JSON.parse(plaintext) as LocationData
}

/**
 * Encrypt location data for a friend (for location sharing)
 * @param location - Location data object
 * @param myPrivateKey - Your X25519 private key
 * @param friendPublicKey - Friend's X25519 public key
 * @returns Encrypted data
 */
export function encryptLocationForFriend(
  location: LocationData,
  myPrivateKey: Uint8Array,
  friendPublicKey: Uint8Array,
): EncryptedData {
  return encryptForFriend(
    JSON.stringify(location),
    myPrivateKey,
    friendPublicKey,
    'parchment-location-v1',
  )
}

/**
 * Decrypt location data from a friend
 * @param ciphertext - Base64-encoded ciphertext
 * @param nonce - Base64-encoded nonce
 * @param myPrivateKey - Your X25519 private key
 * @param friendPublicKey - Friend's X25519 public key
 * @returns Decrypted location data
 */
export function decryptLocationFromFriend(
  ciphertext: string,
  nonce: string,
  myPrivateKey: Uint8Array,
  friendPublicKey: Uint8Array,
): LocationData {
  const plaintext = decryptFromFriend(
    ciphertext,
    nonce,
    myPrivateKey,
    friendPublicKey,
    'parchment-location-v1',
  )
  return JSON.parse(plaintext) as LocationData
}

// ============================================================================
// Utility functions (exported for general use)
// ============================================================================

export function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binaryString = ''
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i])
  }
  return btoa(binaryString)
}

function sortObjectKeys(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj
  if (Array.isArray(obj)) return obj.map(sortObjectKeys)

  return Object.keys(obj as Record<string, unknown>)
    .sort()
    .reduce((sorted: Record<string, unknown>, key) => {
      sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key])
      return sorted
    }, {})
}
