/**
 * Server-side envelope inspection.
 *
 * The server never decrypts user data — but it does need to:
 *   - tell v1 blobs apart from v2 envelopes (for rotation / migration jobs)
 *   - reject obviously malformed envelopes at ingest
 *   - record which envelope version each row was written under, so future
 *     rotation work can batch by version
 *
 * We deliberately do NOT import `@noble/ciphers` here — the server has no
 * business decrypting user payloads. If that ever becomes necessary (e.g.
 * KMS-encrypted server-side secrets), it goes in a separate module with an
 * explicit threat-model justification.
 *
 * The web client's crypto-envelope.ts is the authoritative implementation;
 * this file is a strict subset.
 */

export const ENVELOPE_VERSION_V2 = 0x02
export const ALGO_AES_256_GCM = 0x01

const HEADER_LEN = 2
const NONCE_LEN = 12
const MIN_ENVELOPE_LEN = HEADER_LEN + NONCE_LEN + 16 // +16 = AES-GCM tag

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Extract the leading version byte without decoding further. Returns null
 * on inputs that can't even hold a version byte.
 */
export function readEnvelopeVersion(
  envelope: Uint8Array | string,
): number | null {
  let bytes: Uint8Array
  try {
    bytes = typeof envelope === 'string' ? base64ToBytes(envelope) : envelope
  } catch {
    return null
  }
  if (bytes.length < 1) return null
  return bytes[0]
}

export function isV2Envelope(envelope: Uint8Array | string): boolean {
  return readEnvelopeVersion(envelope) === ENVELOPE_VERSION_V2
}

/**
 * Structural shape check for a v2 envelope. Verifies length + version +
 * algorithm byte. Does NOT verify the auth tag (that requires the key, which
 * the server doesn't have). Use at write time to reject garbage before it
 * lands in the DB.
 */
export function validateV2EnvelopeShape(
  envelope: Uint8Array | string,
): { valid: true } | { valid: false; reason: string } {
  let bytes: Uint8Array
  try {
    bytes = typeof envelope === 'string' ? base64ToBytes(envelope) : envelope
  } catch {
    return { valid: false, reason: 'not valid base64' }
  }
  if (bytes.length < MIN_ENVELOPE_LEN) {
    return {
      valid: false,
      reason: `envelope too short: ${bytes.length} bytes, need ≥ ${MIN_ENVELOPE_LEN}`,
    }
  }
  if (bytes[0] !== ENVELOPE_VERSION_V2) {
    return {
      valid: false,
      reason: `expected v2 (0x02), got 0x${bytes[0].toString(16).padStart(2, '0')}`,
    }
  }
  if (bytes[1] !== ALGO_AES_256_GCM) {
    return {
      valid: false,
      reason: `unsupported algorithm 0x${bytes[1].toString(16).padStart(2, '0')}`,
    }
  }
  return { valid: true }
}
