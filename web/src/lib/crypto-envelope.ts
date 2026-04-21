/**
 * Versioned ciphertext envelope (v2) with Additional Authenticated Data (AAD).
 *
 * Every new ciphertext written by Parchment goes through this module. The
 * envelope format is self-describing, so the read path can dispatch on the
 * version byte — this lets us rotate algorithms or parameters without a
 * data migration.
 *
 * Wire format (bytes):
 *   [version: 1B] [algo: 1B] [nonce: 12B] [ciphertext+tag: n B]
 *
 * AAD (Additional Authenticated Data) is passed OUTSIDE the envelope. AES-GCM
 * binds the auth tag to both ciphertext and AAD, so any tamper with either at
 * rest throws on decrypt. AAD typically includes:
 *   - userId:     the owner of the record
 *   - recordType: an application-level discriminator ("collection", "search-history"…)
 *   - recordId:   the primary key of the record (empty for singleton-per-user blobs)
 *   - keyContext: the HKDF context string the key was derived under
 *
 * Why AAD matters: if a key ever gets reused across record types (or a record
 * gets moved between users, or a rotation job shuffles rows), decryption
 * fails cleanly rather than silently producing wrong plaintext. Defense in
 * depth, not a primary security boundary.
 *
 * v1 back-compat: the legacy `{ciphertext, nonce}` blob format is accepted by
 * `decryptAny()` for a transition window. New writes must use v2.
 */

import { gcm } from '@noble/ciphers/aes.js'
import { randomBytes } from '@noble/ciphers/utils.js'
import { base64ToBytes, bytesToBase64 } from './federation-crypto'

export const ENVELOPE_VERSION_V2 = 0x02
export const ALGO_AES_256_GCM = 0x01

const HEADER_LEN = 2 // version + algo
const NONCE_LEN = 12
const MIN_ENVELOPE_LEN = HEADER_LEN + NONCE_LEN + 16 // +16 = AES-GCM tag

export interface AAD {
  userId: string
  recordType: string
  recordId: string
  keyContext: string
}

/**
 * Legacy v1 blob: a JSON-serializable pair of base64 strings. Never written
 * by new code; accepted by `decryptAny()` to let callers transition record
 * types over time instead of en-masse.
 */
export interface LegacyV1Blob {
  ciphertext: string
  nonce: string
}

export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnvelopeError'
  }
}

/**
 * Encode AAD as a deterministic byte string. Format: each field is a
 * length-prefixed UTF-8 byte sequence, length encoded as big-endian u16.
 * Fixed field order so sender and receiver agree on the bytes AES-GCM hashes.
 *
 * Length prefixes (not separator characters) make the encoding unambiguous
 * — fields can contain any bytes including null or colon, and we never have
 * to escape.
 */
export function encodeAAD(aad: AAD): Uint8Array {
  const encoder = new TextEncoder()
  const parts = [
    encoder.encode(aad.userId),
    encoder.encode(aad.recordType),
    encoder.encode(aad.recordId),
    encoder.encode(aad.keyContext),
  ]
  for (const p of parts) {
    if (p.length > 0xffff) {
      throw new EnvelopeError('AAD field exceeds 65535 bytes')
    }
  }
  const total = parts.reduce((acc, p) => acc + 2 + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out[offset++] = (p.length >> 8) & 0xff
    out[offset++] = p.length & 0xff
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/**
 * Encrypt plaintext bytes into a v2 envelope.
 */
export function encryptEnvelopeBytes(params: {
  plaintext: Uint8Array
  key: Uint8Array
  aad: AAD
}): Uint8Array {
  if (params.key.length !== 32) {
    throw new EnvelopeError(`AES-256-GCM key must be 32 bytes, got ${params.key.length}`)
  }
  const nonce = randomBytes(NONCE_LEN)
  const aadBytes = encodeAAD(params.aad)
  const cipher = gcm(params.key, nonce, aadBytes)
  const ciphertext = cipher.encrypt(params.plaintext)

  const envelope = new Uint8Array(HEADER_LEN + NONCE_LEN + ciphertext.length)
  envelope[0] = ENVELOPE_VERSION_V2
  envelope[1] = ALGO_AES_256_GCM
  envelope.set(nonce, HEADER_LEN)
  envelope.set(ciphertext, HEADER_LEN + NONCE_LEN)
  return envelope
}

/**
 * Decrypt a v2 envelope. Throws on any of: wrong version, wrong algo,
 * wrong AAD, wrong key, or tampered ciphertext.
 */
export function decryptEnvelopeBytes(params: {
  envelope: Uint8Array
  key: Uint8Array
  aad: AAD
}): Uint8Array {
  if (params.envelope.length < MIN_ENVELOPE_LEN) {
    throw new EnvelopeError(
      `Envelope too short: ${params.envelope.length} bytes, need ≥ ${MIN_ENVELOPE_LEN}`,
    )
  }
  const version = params.envelope[0]
  const algo = params.envelope[1]
  if (version !== ENVELOPE_VERSION_V2) {
    throw new EnvelopeError(
      `Unsupported envelope version 0x${version.toString(16).padStart(2, '0')}`,
    )
  }
  if (algo !== ALGO_AES_256_GCM) {
    throw new EnvelopeError(
      `Unsupported algorithm 0x${algo.toString(16).padStart(2, '0')}`,
    )
  }
  const nonce = params.envelope.slice(HEADER_LEN, HEADER_LEN + NONCE_LEN)
  const ciphertext = params.envelope.slice(HEADER_LEN + NONCE_LEN)
  const aadBytes = encodeAAD(params.aad)
  const cipher = gcm(params.key, nonce, aadBytes)
  return cipher.decrypt(ciphertext)
}

/**
 * String-in / string-out convenience for the common case of encrypting UTF-8
 * plaintext and storing the envelope as a base64 column or JSON value.
 */
export function encryptEnvelopeString(params: {
  plaintext: string
  key: Uint8Array
  aad: AAD
}): string {
  const bytes = encryptEnvelopeBytes({
    plaintext: new TextEncoder().encode(params.plaintext),
    key: params.key,
    aad: params.aad,
  })
  return bytesToBase64(bytes)
}

export function decryptEnvelopeString(params: {
  envelope: string
  key: Uint8Array
  aad: AAD
}): string {
  const plaintext = decryptEnvelopeBytes({
    envelope: base64ToBytes(params.envelope),
    key: params.key,
    aad: params.aad,
  })
  return new TextDecoder().decode(plaintext)
}

/**
 * Decrypt either a v2 envelope or a legacy v1 blob. Use during the transition
 * window when reading records that may be either format. AAD is required for
 * v2 and ignored for v1 (v1 had no AAD).
 */
export function decryptAny(params: {
  input: string | Uint8Array | LegacyV1Blob
  key: Uint8Array
  aad: AAD
}): string {
  // Legacy v1 blob: object with ciphertext+nonce base64 strings.
  if (
    typeof params.input === 'object' &&
    !(params.input instanceof Uint8Array) &&
    'ciphertext' in params.input &&
    'nonce' in params.input
  ) {
    const nonceBytes = base64ToBytes(params.input.nonce)
    const ciphertextBytes = base64ToBytes(params.input.ciphertext)
    const cipher = gcm(params.key, nonceBytes)
    const plaintext = cipher.decrypt(ciphertextBytes)
    return new TextDecoder().decode(plaintext)
  }

  // v2 envelope: either base64 string or raw bytes.
  const envelopeBytes =
    typeof params.input === 'string'
      ? base64ToBytes(params.input)
      : params.input

  return decryptEnvelopeString({
    envelope: bytesToBase64(envelopeBytes),
    key: params.key,
    aad: params.aad,
  })
}

/**
 * Inspect an envelope's version byte without decrypting. Useful for
 * rotation jobs and auditing.
 */
export function readEnvelopeVersion(
  envelope: Uint8Array | string,
): number | null {
  const bytes =
    typeof envelope === 'string' ? base64ToBytes(envelope) : envelope
  if (bytes.length < 1) return null
  return bytes[0]
}

export function isV2Envelope(envelope: Uint8Array | string): boolean {
  return readEnvelopeVersion(envelope) === ENVELOPE_VERSION_V2
}
