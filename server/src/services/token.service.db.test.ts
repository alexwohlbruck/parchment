/**
 * DB-backed tests for OTP expiry.
 *
 * The unit tests mock the database, so they can't prove the property that
 * actually matters here: that a code stored in Postgres stops working once
 * its `expires` timestamp passes. This drives the real table.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../schema/users.schema'
import { tokens } from '../schema/tokens.schema'
import { generateId } from '../util'
import {
  createServerToken,
  validateServerToken,
  TOKEN_TTL_MS,
} from './token.service'

const RUN_SUFFIX = Math.random().toString(36).slice(2, 8)
let userId = ''

beforeAll(async () => {
  userId = generateId()
  await db.insert(users).values({
    id: userId,
    email: `otp-${RUN_SUFFIX}@parchment.test`,
    alias: `otp_${RUN_SUFFIX}`,
    signingKey: 'sig',
    encryptionKey: 'enc',
  })
})

afterAll(async () => {
  if (userId) await db.delete(users).where(eq(users.id, userId))
})

/** Move the user's stored OTP into the past. */
async function backdate() {
  await db
    .update(tokens)
    .set({ expires: new Date(Date.now() - 1000) })
    .where(eq(tokens.userId, userId))
}

describe('OTP expiry against the real table', () => {
  test('a fresh code signs in', async () => {
    const code = await createServerToken('otp', userId)

    expect(await validateServerToken(code, 'otp', userId)).toBe('valid')
  })

  test('an expired code is refused', async () => {
    const code = await createServerToken('otp', userId)
    await backdate()

    expect(await validateServerToken(code, 'otp', userId)).toBe('expired')
  })

  test('the refused code is cleared, so retrying finds nothing', async () => {
    const code = await createServerToken('otp', userId)
    await backdate()

    await validateServerToken(code, 'otp', userId)

    const left = await db.select().from(tokens).where(eq(tokens.userId, userId))
    expect(left).toHaveLength(0)
    expect(await validateServerToken(code, 'otp', userId)).toBe('invalid')
  })

  test('a code issued now carries a future expiry', async () => {
    await createServerToken('otp', userId)

    const [row] = await db
      .select()
      .from(tokens)
      .where(eq(tokens.userId, userId))
    expect(row.expires.getTime()).toBeGreaterThan(Date.now())
    expect(row.expires.getTime()).toBeLessThanOrEqual(Date.now() + TOKEN_TTL_MS)
  })
})
