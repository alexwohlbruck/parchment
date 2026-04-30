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
import {
  encryptEnvelopeBytes,
  decryptEnvelopeBytes,
  type AAD,
} from './crypto-envelope'

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
 * Build a canonical message string for signing (v1, legacy).
 * Retained for message types that have not yet been migrated to v2.
 * New code should use buildSignableMessageV2.
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

/**
 * v2 federation envelope: covers nonce, timestamp, and protocol_version so a
 * signature binds the complete message intent. The server recomputes this
 * string and verifies against the same Ed25519 signature.
 */
export interface SignableEnvelopeV2 {
  protocol_version: number
  message_type: string
  message_version: number
  from: string
  to: string
  nonce: string
  timestamp: string
  payload: Record<string, unknown>
}

export function buildSignableMessageV2(env: SignableEnvelopeV2): string {
  return JSON.stringify(
    sortObjectKeys({
      protocol_version: env.protocol_version,
      message_type: env.message_type,
      message_version: env.message_version,
      from: env.from,
      to: env.to,
      nonce: env.nonce,
      timestamp: env.timestamp,
      payload: env.payload,
    }),
  )
}

/**
 * Generate a 16-byte random nonce, base64-encoded. Used by the v2 envelope.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return bytesToBase64(bytes)
}

// ============================================================================
// Key Derivation for E2EE
// ============================================================================

/**
 * HKDF `info` context for the personal encryption key. Also used as the
 * v2-envelope `keyContext` when building AAD for personal-blob ciphertexts
 * (search history, friend pins, user-e2ee integration configs, etc.).
 * Consumers that craft AAD by hand should import this constant — never
 * hard-code the string — so HKDF and AAD stay in lock-step.
 */
export const PERSONAL_KEY_CONTEXT = 'parchment-personal-v1'

/**
 * Derive a personal encryption key from the user's seed
 * Used for encrypting personal data (saved places, search history, etc.)
 * @param seed - 32-byte user seed
 * @returns 32-byte AES key
 */
export function derivePersonalKey(seed: Uint8Array): Uint8Array {
  return hkdf(
    sha256,
    seed,
    undefined,
    new TextEncoder().encode(PERSONAL_KEY_CONTEXT),
    32,
  )
}

/**
 * Derive the metadata encryption key from the user's seed.
 * Separate HKDF context (parchment-metadata-v1) keeps it domain-separated
 * from the personal key — a misconfiguration that reused one key for
 * both buckets would fail AEAD rather than silently cross-decrypting.
 */
export function deriveMetadataKey(seed: Uint8Array): Uint8Array {
  return hkdf(
    sha256,
    seed,
    undefined,
    new TextEncoder().encode('parchment-metadata-v1'),
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
  keyVersion: number = 1,
): Uint8Array {
  // Version 1 keeps the legacy `parchment-collection-${id}` HKDF context for
  // backward compatibility with collections created before key rotation was
  // introduced. Higher versions append `-v${n}` so rotation produces a fresh,
  // independent key that old-revoked share recipients cannot derive.
  const info =
    keyVersion === 1
      ? `parchment-collection-${collectionId}`
      : `parchment-collection-${collectionId}-v${keyVersion}`
  return hkdf(sha256, seed, undefined, new TextEncoder().encode(info), 32)
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
// ECIES forward-secret friend sharing (v2)
// ============================================================================
//
// v1 used static DH: every ciphertext between (Alice, Bob) shared the same
// AES key derived from their long-term X25519 pair. If either long-term
// private leaks later, every past ciphertext decrypts.
//
// v2 (ECIES): the sender generates an ephemeral X25519 keypair per message,
// does ECDH with the recipient's long-term encryption key, and discards the
// ephemeral private immediately. The blob is signed with the sender's
// long-term Ed25519 key so the recipient can authenticate it. AAD binds
// sender, recipient, relationship, and timestamp — blocking cross-context
// replay.
//
// Not Double Ratchet: a recipient long-term compromise still reveals past
// ciphertexts that an attacker captured on the wire. The handoff spec
// deliberately trades that for simplicity at 60s broadcast cadence.
//
// Wire layout:
//   [ephemeral_pub: 32B] [envelope_v2: variable] [signature: 64B Ed25519]
// Signature covers ephemeral_pub || envelope_v2.

const ECIES_KEY_CONTEXT = 'parchment-ecies-v1'
const EPHEMERAL_PUB_LEN = 32
const ED25519_SIG_LEN = 64

export interface FriendShareBinding {
  senderId: string // full handle e.g. "alice@a.example"
  recipientId: string
  relationshipId: string
  timestamp: string // RFC 3339
}

/**
 * Canonical relationshipId derived from the two parties' handles. Both
 * sides compute identical IDs by sorting first — order doesn't depend on
 * who's encrypting. Kept case-sensitive: the AAD binding embeds the
 * relationshipId verbatim, so changing the case-folding rule would break
 * decryption of any blob encrypted with the old rule. Lowercasing for
 * comparisons happens at the API boundary, not here.
 */
export function buildRelationshipId(a: string, b: string): string {
  const [first, second] = a < b ? [a, b] : [b, a]
  return `${first}::${second}`
}

function buildFriendShareAAD(b: FriendShareBinding): AAD {
  return {
    userId: b.recipientId,
    recordType: 'friend-share-v2',
    recordId: b.relationshipId,
    // Pack sender + recipient + timestamp into keyContext so the AAD struct
    // stays fixed-shape. AES-GCM binds the entire concatenation; any mismatch
    // fails decrypt.
    keyContext: `${ECIES_KEY_CONTEXT}|from=${b.senderId}|to=${b.recipientId}|ts=${b.timestamp}`,
  }
}

/**
 * Encrypt a plaintext string for a friend under ECIES. Returns the full blob
 * as base64.
 */
export async function encryptForFriendV2(params: {
  plaintext: string
  mySigningPrivateKey: Uint8Array
  friendEncryptionPublicKey: Uint8Array
  binding: FriendShareBinding
}): Promise<string> {
  const ephemeralPriv = crypto.getRandomValues(new Uint8Array(32))
  try {
    const ephemeralPub = x25519.getPublicKey(ephemeralPriv)

    const sharedSecret = x25519.getSharedSecret(
      ephemeralPriv,
      params.friendEncryptionPublicKey,
    )
    const aesKey = hkdf(
      sha256,
      sharedSecret,
      undefined,
      new TextEncoder().encode(ECIES_KEY_CONTEXT),
      32,
    )

    const aad = buildFriendShareAAD(params.binding)
    const envelope = encryptEnvelopeBytes({
      plaintext: new TextEncoder().encode(params.plaintext),
      key: aesKey,
      aad,
    })

    const toSign = new Uint8Array(ephemeralPub.length + envelope.length)
    toSign.set(ephemeralPub, 0)
    toSign.set(envelope, ephemeralPub.length)
    const signature = await ed.signAsync(toSign, params.mySigningPrivateKey)

    const blob = new Uint8Array(
      ephemeralPub.length + envelope.length + signature.length,
    )
    blob.set(ephemeralPub, 0)
    blob.set(envelope, ephemeralPub.length)
    blob.set(signature, ephemeralPub.length + envelope.length)

    return bytesToBase64(blob)
  } finally {
    // Hygiene: zero the ephemeral private. JS makes no memory-wipe
    // guarantees, but this communicates intent and helps some runtimes.
    ephemeralPriv.fill(0)
  }
}

/**
 * Decrypt a v2 ECIES blob. Verifies sender's long-term signature and AAD;
 * throws on any failure.
 */
export function decryptForFriendV2(params: {
  blob: string
  myEncryptionPrivateKey: Uint8Array
  senderSigningPublicKey: Uint8Array
  binding: FriendShareBinding
}): string {
  const raw = base64ToBytes(params.blob)
  if (raw.length < EPHEMERAL_PUB_LEN + ED25519_SIG_LEN) {
    throw new Error('ECIES blob too short')
  }

  const ephemeralPub = raw.slice(0, EPHEMERAL_PUB_LEN)
  const envelope = raw.slice(EPHEMERAL_PUB_LEN, raw.length - ED25519_SIG_LEN)
  const signature = raw.slice(raw.length - ED25519_SIG_LEN)

  const signedBytes = new Uint8Array(ephemeralPub.length + envelope.length)
  signedBytes.set(ephemeralPub, 0)
  signedBytes.set(envelope, ephemeralPub.length)
  if (!ed.verify(signature, signedBytes, params.senderSigningPublicKey)) {
    throw new Error('ECIES signature invalid — sender authentication failed')
  }

  const sharedSecret = x25519.getSharedSecret(
    params.myEncryptionPrivateKey,
    ephemeralPub,
  )
  const aesKey = hkdf(
    sha256,
    sharedSecret,
    undefined,
    new TextEncoder().encode(ECIES_KEY_CONTEXT),
    32,
  )

  const aad = buildFriendShareAAD(params.binding)
  const plaintext = decryptEnvelopeBytes({ envelope, key: aesKey, aad })
  return new TextDecoder().decode(plaintext)
}

/**
 * Encrypt LocationData for a friend under ECIES (v2). Convenience over
 * encryptForFriendV2 for the common location-broadcast case.
 */
export async function encryptLocationForFriendV2(params: {
  location: LocationData
  mySigningPrivateKey: Uint8Array
  friendEncryptionPublicKey: Uint8Array
  binding: FriendShareBinding
}): Promise<string> {
  return encryptForFriendV2({
    plaintext: JSON.stringify(params.location),
    mySigningPrivateKey: params.mySigningPrivateKey,
    friendEncryptionPublicKey: params.friendEncryptionPublicKey,
    binding: params.binding,
  })
}

export function decryptLocationFromFriendV2(params: {
  blob: string
  myEncryptionPrivateKey: Uint8Array
  senderSigningPublicKey: Uint8Array
  binding: FriendShareBinding
}): LocationData {
  return JSON.parse(decryptForFriendV2(params)) as LocationData
}

// ============================================================================
// Location-specific encryption helpers
// ============================================================================

/**
 * Shape of a location sample shared between friends. Kept here because the
 * v2 encrypt/decrypt helpers in this file + consumers in
 * `useFriendLocations.ts` / `useE2eeLocationBroadcast.ts` all import it.
 *
 * The v1 encrypt/decrypt functions that used to live here
 * (`encryptLocation`, `decryptLocation`, `encryptLocationForFriend`,
 * `decryptLocationFromFriend`) have been removed — all production flows go
 * through `encryptLocationForFriendV2` / `decryptLocationFromFriendV2` with
 * proper AAD binding.
 */
export interface LocationData {
  lat: number
  lng: number
  accuracy?: number
  altitude?: number
  altitudeAccuracy?: number
  speed?: number
  heading?: number
  battery?: number // 0-1 representing battery percentage
  batteryCharging?: boolean
  timestamp: number
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

/**
 * Lexicographic byte comparison — shorter prefix wins ties. Used to produce a
 * canonical ordering when two parties must agree on input ordering to derive
 * the same symmetric value (SAS digits, safety numbers). Not constant-time;
 * inputs are public keys, not secrets.
 */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
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
