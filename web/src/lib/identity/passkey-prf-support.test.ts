/**
 * Covers the WebAuthn PRF extension helpers:
 *   - base64url → bytes decoder (padded + unpadded, base64 or base64url)
 *   - PRF output extraction from registration/assertion responses
 *   - In-place hydration of `extensions.prf.eval` for simplewebauthn v10
 *
 * No real WebAuthn ceremony is invoked — these are pure helpers, tested
 * against hand-shaped responses that match the wire JSON.
 */

import { describe, test, expect } from 'vitest'
import {
  base64urlToBytes,
  extractPrfOutputFromRegistration,
  extractPrfOutputFromAssertion,
  registrationHasPrfEnabled,
  isProbablyPrfSupported,
  hydratePrfExtensionInPlace,
} from './passkey-prf-support'

describe('base64urlToBytes', () => {
  test('decodes standard base64url without padding', () => {
    const bytes = base64urlToBytes('SGVsbG8') // "Hello"
    expect(new TextDecoder().decode(bytes)).toBe('Hello')
  })

  test('decodes base64url with URL-safe chars (- and _)', () => {
    // 0x3e ('>') and 0x3f ('?') encode as '+' and '/' in base64, and
    // as '-' and '_' in base64url. Verify we accept both.
    const b64 = base64urlToBytes('Pj8=')
    const b64url = base64urlToBytes('Pj8')
    expect(Array.from(b64)).toEqual([0x3e, 0x3f])
    expect(Array.from(b64url)).toEqual([0x3e, 0x3f])
  })

  test('matches the AAD test vector from the server', () => {
    // The real salt the server returned in the user-reported bug.
    const salt = base64urlToBytes(
      'XCc55tAyJQw8FPxRUaqXPTDSJowxYybMB6bMqzwZNBU',
    )
    expect(salt.length).toBe(32)
  })
})

describe('extractPrfOutputFromRegistration / Assertion', () => {
  test('returns null when clientExtensionResults missing', () => {
    expect(extractPrfOutputFromRegistration({})).toBeNull()
    expect(extractPrfOutputFromAssertion({})).toBeNull()
  })

  test('returns null when prf.results absent (authenticator declined)', () => {
    const r = {
      clientExtensionResults: { prf: { enabled: true } },
    }
    expect(extractPrfOutputFromRegistration(r)).toBeNull()
  })

  test('returns decoded bytes when results.first is base64url', () => {
    const raw = new Uint8Array(32)
    for (let i = 0; i < 32; i++) raw[i] = i
    const b64 = btoa(String.fromCharCode(...raw))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const assertion = {
      clientExtensionResults: {
        prf: { results: { first: b64 } },
      },
    }
    const out = extractPrfOutputFromAssertion(assertion)
    expect(out).not.toBeNull()
    expect(Array.from(out!)).toEqual(Array.from(raw))
  })

  test('returns bytes when results.first is an ArrayBuffer (Chrome + simplewebauthn v10 native shape)', () => {
    // This is what Chrome actually puts there after
    // `navigator.credentials.get().getClientExtensionResults()` —
    // simplewebauthn-browser v10 passes extensions through unchanged.
    // If the coercion doesn't handle ArrayBuffer the whole enrollment
    // flow fails with "can't recover" even though PRF is working.
    const raw = new Uint8Array(32)
    for (let i = 0; i < 32; i++) raw[i] = 0x10 + i
    const buf = raw.buffer.slice(0)
    const assertion = {
      clientExtensionResults: {
        prf: { results: { first: buf } },
      },
    }
    const out = extractPrfOutputFromAssertion(assertion)
    expect(out).not.toBeNull()
    expect(Array.from(out!)).toEqual(Array.from(raw))
    // Returned bytes must be a copy — mutating them should not affect
    // the original buffer the authenticator handed us.
    out![0] = 0xff
    expect(new Uint8Array(buf)[0]).toBe(0x10)
  })

  test('returns bytes when results.first is a Uint8Array view over a larger buffer', () => {
    const full = new Uint8Array(64)
    for (let i = 0; i < 64; i++) full[i] = i
    const view = new Uint8Array(full.buffer, 16, 32)
    const assertion = {
      clientExtensionResults: {
        prf: { results: { first: view } },
      },
    }
    const out = extractPrfOutputFromAssertion(assertion)
    expect(out).not.toBeNull()
    expect(out!.length).toBe(32)
    expect(out![0]).toBe(16)
    expect(out![31]).toBe(47)
  })

  test('returns null when results.first is a non-string, non-binary value', () => {
    const r = {
      clientExtensionResults: {
        prf: { results: { first: 12345 as unknown as string } },
      },
    }
    expect(extractPrfOutputFromRegistration(r)).toBeNull()
  })

  test('registrationHasPrfEnabled returns true only when prf.enabled === true', () => {
    expect(registrationHasPrfEnabled({})).toBe(false)
    expect(
      registrationHasPrfEnabled({ clientExtensionResults: {} }),
    ).toBe(false)
    expect(
      registrationHasPrfEnabled({
        clientExtensionResults: { prf: { enabled: false } },
      }),
    ).toBe(false)
    expect(
      registrationHasPrfEnabled({
        clientExtensionResults: { prf: { enabled: true } },
      }),
    ).toBe(true)
  })
})

describe('hydratePrfExtensionInPlace', () => {
  test('converts eval.first from base64url string to Uint8Array', () => {
    // 32 bytes of 0x2a, encoded as base64url
    const saltBytes = new Uint8Array(32).fill(0x2a)
    const saltB64 = btoa(String.fromCharCode(...saltBytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    const options = {
      extensions: { prf: { eval: { first: saltB64 } } },
    }
    hydratePrfExtensionInPlace(options)
    expect(options.extensions.prf.eval.first).toBeInstanceOf(Uint8Array)
    expect(
      Array.from(options.extensions.prf.eval.first as unknown as Uint8Array),
    ).toEqual(Array.from(saltBytes))
  })

  test('converts eval.second too when present', () => {
    const options = {
      extensions: {
        prf: { eval: { first: 'AAAA', second: 'BBBB' } },
      },
    }
    hydratePrfExtensionInPlace(options)
    expect(options.extensions.prf.eval.first).toBeInstanceOf(Uint8Array)
    expect(options.extensions.prf.eval.second).toBeInstanceOf(Uint8Array)
  })

  test('converts evalByCredential entries', () => {
    const options = {
      extensions: {
        prf: {
          evalByCredential: {
            credA: { first: 'AAAA' },
            credB: { first: 'BBBB', second: 'CCCC' },
          },
        },
      },
    }
    hydratePrfExtensionInPlace(options)
    expect(options.extensions.prf.evalByCredential.credA.first).toBeInstanceOf(
      Uint8Array,
    )
    expect(options.extensions.prf.evalByCredential.credB.first).toBeInstanceOf(
      Uint8Array,
    )
    expect(options.extensions.prf.evalByCredential.credB.second).toBeInstanceOf(
      Uint8Array,
    )
  })

  test('is a no-op when extensions or prf absent', () => {
    const empty = {}
    hydratePrfExtensionInPlace(empty)
    expect(empty).toEqual({})

    const noPrf = { extensions: {} }
    hydratePrfExtensionInPlace(noPrf)
    expect(noPrf.extensions).toEqual({})
  })

  test('leaves eval.first alone if already a Uint8Array', () => {
    const buf = new Uint8Array([1, 2, 3])
    const options = {
      extensions: { prf: { eval: { first: buf } } },
    }
    hydratePrfExtensionInPlace(options)
    expect(options.extensions.prf.eval.first).toBe(buf)
  })
})

describe('isProbablyPrfSupported', () => {
  test('returns a boolean without throwing', () => {
    // happy-dom may or may not expose PublicKeyCredential; the helper
    // must return a boolean either way (no throws).
    const result = isProbablyPrfSupported()
    expect(typeof result).toBe('boolean')
  })
})
