/**
 * Tests for the metadata-crypto wrapper. Correctness of the underlying
 * envelope is covered in crypto-envelope.test.ts; here we verify the
 * AAD binding (field name + user id) is applied consistently so an
 * envelope from one field can't be replayed as another.
 */

import { describe, test, expect } from 'vitest'
import {
  encryptMetadataField,
  decryptMetadataField,
  tryDecryptMetadataField,
} from './metadata-crypto'

function seedOf(byte: number): Uint8Array {
  const s = new Uint8Array(32)
  s.fill(byte)
  return s
}

const seed = seedOf(0x42)
const userId = 'user-abc'

describe('metadata-crypto', () => {
  test('round-trips plaintext for a field', () => {
    const env = encryptMetadataField({
      plaintext: 'Alice',
      seed,
      userId,
      fieldName: 'first_name',
    })
    const out = decryptMetadataField({
      envelope: env,
      seed,
      userId,
      fieldName: 'first_name',
    })
    expect(out).toBe('Alice')
  })

  test('AAD binds the field name — cross-field swap fails', () => {
    const env = encryptMetadataField({
      plaintext: 'Alice',
      seed,
      userId,
      fieldName: 'first_name',
    })
    expect(() =>
      decryptMetadataField({
        envelope: env,
        seed,
        userId,
        fieldName: 'last_name',
      }),
    ).toThrow()
  })

  test('AAD binds the user id — different user fails', () => {
    const env = encryptMetadataField({
      plaintext: 'Alice',
      seed,
      userId,
      fieldName: 'first_name',
    })
    expect(() =>
      decryptMetadataField({
        envelope: env,
        seed,
        userId: 'user-xyz',
        fieldName: 'first_name',
      }),
    ).toThrow()
  })

  test('different seed fails', () => {
    const env = encryptMetadataField({
      plaintext: 'Alice',
      seed,
      userId,
      fieldName: 'first_name',
    })
    expect(() =>
      decryptMetadataField({
        envelope: env,
        seed: seedOf(0x43),
        userId,
        fieldName: 'first_name',
      }),
    ).toThrow()
  })

  test('two encrypts of the same plaintext produce different envelopes', () => {
    const a = encryptMetadataField({
      plaintext: 'Alice',
      seed,
      userId,
      fieldName: 'first_name',
    })
    const b = encryptMetadataField({
      plaintext: 'Alice',
      seed,
      userId,
      fieldName: 'first_name',
    })
    expect(a).not.toBe(b)
  })

  test('tryDecryptMetadataField returns null on missing envelope', () => {
    expect(
      tryDecryptMetadataField({
        envelope: null,
        seed,
        userId,
        fieldName: 'first_name',
      }),
    ).toBeNull()
    expect(
      tryDecryptMetadataField({
        envelope: '',
        seed,
        userId,
        fieldName: 'first_name',
      }),
    ).toBeNull()
  })

  test('tryDecryptMetadataField returns null on missing seed', () => {
    const env = encryptMetadataField({
      plaintext: 'Alice',
      seed,
      userId,
      fieldName: 'first_name',
    })
    expect(
      tryDecryptMetadataField({
        envelope: env,
        seed: null,
        userId,
        fieldName: 'first_name',
      }),
    ).toBeNull()
  })

  test('tryDecryptMetadataField returns null on bad envelope', () => {
    expect(
      tryDecryptMetadataField({
        envelope: 'not-a-valid-envelope',
        seed,
        userId,
        fieldName: 'first_name',
      }),
    ).toBeNull()
  })

  test('tryDecryptMetadataField returns plaintext on success', () => {
    const env = encryptMetadataField({
      plaintext: 'Alice',
      seed,
      userId,
      fieldName: 'first_name',
    })
    expect(
      tryDecryptMetadataField({
        envelope: env,
        seed,
        userId,
        fieldName: 'first_name',
      }),
    ).toBe('Alice')
  })
})
