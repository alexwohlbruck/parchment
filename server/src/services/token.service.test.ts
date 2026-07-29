/**
 * Unit tests for server-issued tokens (email OTPs and OAuth state tokens).
 *
 * Two properties carry the security weight:
 *   - the code is stored as a SHA-256 hash, never in plaintext, so a database
 *     read can't hand an attacker a live OTP;
 *   - an ephemeral token is deleted the moment it validates, making it
 *     single-use — otherwise a leaked OTP would stay valid for its whole
 *     lifetime.
 *
 * The DB layer is mocked; what's under test is the hashing, the single-use
 * deletion, and the per-type code generation.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { sha256 } from 'oslo/crypto'
import { encodeHex } from 'oslo/encoding'
import { createDbMock } from '../test/db-mock'

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))
mock.module('../util', () => ({ generateId: () => 'generated-id' }))

const { createServerToken, validateServerToken } = await import('./token.service')

/** The hash the service would store for a given plaintext code. */
async function hashOf(code: string): Promise<string> {
  return encodeHex(await sha256(new TextEncoder().encode(code)))
}

beforeEach(() => {
  dbMock.reset()
})

describe('createServerToken', () => {
  test('generates an 8-digit numeric code for an OTP', async () => {
    const code = await createServerToken('otp', 'user-1')

    expect(code).toMatch(/^\d{8}$/)
  })

  test('generates an id-shaped code for a state token', async () => {
    const code = await createServerToken('token', 'user-1')

    expect(code).toBe('generated-id')
  })

  test('honours an explicitly supplied code', async () => {
    const code = await createServerToken('otp', 'user-1', '00000000')

    expect(code).toBe('00000000')
  })

  test('stores only the hash, never the plaintext code', async () => {
    const code = await createServerToken('otp', 'user-1')

    const row = dbMock.inserted[0] as any
    expect(row.hash).toBe(await hashOf(code))
    expect(row.value).toBeUndefined()
    expect(JSON.stringify(row)).not.toContain(code)
  })

  test('stores the plaintext when hashing is disabled', async () => {
    // OAuth state tokens are looked up by value, so they are stored as-is.
    const code = await createServerToken('token', 'user-1', undefined, false)

    const row = dbMock.inserted[0] as any
    expect(row.value).toBe(code)
    expect(row.hash).toBeUndefined()
  })

  test('binds the row to the user and type', async () => {
    await createServerToken('otp', 'user-9')

    expect(dbMock.inserted[0]).toMatchObject({
      userId: 'user-9',
      type: 'otp',
      ephemeral: true,
    })
  })

  test('clears any earlier ephemeral token of the same type first', async () => {
    // Otherwise requesting a second OTP would leave the first one valid.
    await createServerToken('otp', 'user-1')

    expect(dbMock.deleteCount).toBe(1)
  })

  test('does not clear earlier tokens when non-ephemeral', async () => {
    await createServerToken('token', 'user-1', undefined, true, false)

    expect(dbMock.deleteCount).toBe(0)
    expect((dbMock.inserted[0] as any).ephemeral).toBe(false)
  })

  test('issues a different OTP each time', async () => {
    const codes = new Set<string>()
    for (let i = 0; i < 20; i++) {
      dbMock.reset()
      codes.add(await createServerToken('otp', 'user-1'))
    }

    // 20 draws from 10^8 — a collision here would mean the generator is broken.
    expect(codes.size).toBeGreaterThan(15)
  })
})

describe('validateServerToken', () => {
  test('accepts the matching code', async () => {
    const hash = await hashOf('12345678')
    dbMock.queueSelect([{ id: 'tok-1', hash, ephemeral: true }])

    expect(await validateServerToken('12345678', 'otp', 'user-1')).toBe(true)
  })

  test('rejects a wrong code', async () => {
    const hash = await hashOf('12345678')
    dbMock.queueSelect([{ id: 'tok-1', hash, ephemeral: true }])

    expect(await validateServerToken('87654321', 'otp', 'user-1')).toBe(false)
  })

  test('rejects when the user has no token of that type', async () => {
    dbMock.queueSelect([])

    expect(await validateServerToken('12345678', 'otp', 'user-1')).toBe(false)
  })

  test('consumes an ephemeral token on success — single use', async () => {
    const hash = await hashOf('12345678')
    dbMock.queueSelect([{ id: 'tok-1', hash, ephemeral: true }])

    await validateServerToken('12345678', 'otp', 'user-1')

    expect(dbMock.deleteCount).toBe(1)
  })

  test('leaves a non-ephemeral token in place', async () => {
    const hash = await hashOf('long-lived')
    dbMock.queueSelect([{ id: 'tok-1', hash, ephemeral: false }])

    expect(await validateServerToken('long-lived', 'token', 'user-1')).toBe(true)
    expect(dbMock.deleteCount).toBe(0)
  })

  test('does not delete anything on a failed match', async () => {
    const hash = await hashOf('12345678')
    dbMock.queueSelect([{ id: 'tok-1', hash, ephemeral: true }])

    await validateServerToken('wrong', 'otp', 'user-1')

    expect(dbMock.deleteCount).toBe(0)
  })

  test('matches against any of several stored tokens', async () => {
    dbMock.queueSelect([
      { id: 'tok-1', hash: await hashOf('11111111'), ephemeral: true },
      { id: 'tok-2', hash: await hashOf('22222222'), ephemeral: true },
    ])

    expect(await validateServerToken('22222222', 'otp', 'user-1')).toBe(true)
  })

  test('a row with no hash never matches', async () => {
    // Non-hashed rows are looked up by value elsewhere; they must not be
    // matchable through the hash path with an undefined hash.
    dbMock.queueSelect([{ id: 'tok-1', value: '12345678', ephemeral: true }])

    expect(await validateServerToken('12345678', 'otp', 'user-1')).toBe(false)
  })
})

describe('round trip', () => {
  test('a freshly created OTP validates', async () => {
    const code = await createServerToken('otp', 'user-1')
    const stored = dbMock.inserted[0] as any

    dbMock.queueSelect([{ id: 'tok-1', hash: stored.hash, ephemeral: true }])

    expect(await validateServerToken(code, 'otp', 'user-1')).toBe(true)
  })

  test('the same code does not validate for a different stored hash', async () => {
    await createServerToken('otp', 'user-1', '11111111')

    dbMock.queueSelect([
      { id: 'tok-1', hash: await hashOf('99999999'), ephemeral: true },
    ])

    expect(await validateServerToken('11111111', 'otp', 'user-1')).toBe(false)
  })
})
