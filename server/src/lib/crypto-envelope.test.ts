/**
 * Tests for the server-side envelope inspector. The server never decrypts,
 * so the surface here is strictly structural — version extraction and
 * shape validation.
 */

import { describe, test, expect } from 'bun:test'
import {
  readEnvelopeVersion,
  isV2Envelope,
  validateV2EnvelopeShape,
  ENVELOPE_VERSION_V2,
  ALGO_AES_256_GCM,
} from './crypto-envelope'

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function makeV2Envelope(payloadLen = 20): Uint8Array {
  const env = new Uint8Array(2 + 12 + payloadLen + 16)
  env[0] = ENVELOPE_VERSION_V2
  env[1] = ALGO_AES_256_GCM
  // Remaining bytes are zeros — fine for a shape check (we can't and don't
  // verify the auth tag without the key).
  return env
}

describe('readEnvelopeVersion', () => {
  test('returns the version byte from bytes', () => {
    expect(readEnvelopeVersion(makeV2Envelope())).toBe(ENVELOPE_VERSION_V2)
  })

  test('returns the version byte from base64', () => {
    expect(readEnvelopeVersion(bytesToBase64(makeV2Envelope()))).toBe(
      ENVELOPE_VERSION_V2,
    )
  })

  test('returns null on empty bytes', () => {
    expect(readEnvelopeVersion(new Uint8Array(0))).toBeNull()
  })

  test('returns null on invalid base64 input', () => {
    // atob throws on non-base64; our wrapper catches and returns null.
    expect(readEnvelopeVersion('!!!not base64!!!')).toBeNull()
  })
})

describe('isV2Envelope', () => {
  test('true for a v2 envelope', () => {
    expect(isV2Envelope(makeV2Envelope())).toBe(true)
  })

  test('false for an unknown version byte', () => {
    const env = makeV2Envelope()
    env[0] = 0x09
    expect(isV2Envelope(env)).toBe(false)
  })

  test('false for too-short input', () => {
    expect(isV2Envelope(new Uint8Array(0))).toBe(false)
  })
})

describe('validateV2EnvelopeShape', () => {
  test('accepts a well-formed envelope', () => {
    const result = validateV2EnvelopeShape(makeV2Envelope())
    expect(result.valid).toBe(true)
  })

  test('rejects an envelope shorter than the minimum length', () => {
    const result = validateV2EnvelopeShape(new Uint8Array([0x02, 0x01, 0x00]))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toMatch(/too short/)
  })

  test('rejects a non-v2 version byte', () => {
    const env = makeV2Envelope()
    env[0] = 0x01
    const result = validateV2EnvelopeShape(env)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toMatch(/expected v2/)
  })

  test('rejects an unknown algorithm byte', () => {
    const env = makeV2Envelope()
    env[1] = 0x09
    const result = validateV2EnvelopeShape(env)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toMatch(/algorithm/)
  })

  test('rejects non-base64 string input', () => {
    const result = validateV2EnvelopeShape('!!!not base64!!!')
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toMatch(/base64/)
  })
})
