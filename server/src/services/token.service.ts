import { timingSafeEqual } from 'node:crypto'
import { alphabet, generateRandomString } from 'oslo/crypto'
import { eq, and } from 'drizzle-orm'
import { db } from '../db'
import { generateId } from '../util'
import { NewToken, Token, tokens } from '../schema/tokens.schema'
import { User } from '../schema/users.schema'
import { hashSecret } from '../lib/auth/secret-hash'

/**
 * How long a server-issued token stays usable. Mirrors the column default in
 * the schema, but set explicitly so the lifetime lives with the code that
 * enforces it. Callers with different needs (OAuth state) set their own.
 */
export const TOKEN_TTL_MS = 15 * 60 * 1000

export async function createServerToken(
  type: Token['type'],
  userId: User['id'],
  value?: string,
  hashed = true,
  ephemeral = true,
) {
  if (ephemeral) {
    await db
      .delete(tokens)
      .where(and(eq(tokens.userId, userId), eq(tokens.type, type)))
  }

  let code
  if (value) {
    code = value
  } else {
    switch (type) {
      case 'otp':
        code = generateRandomString(8, alphabet('0-9'))
        break
      case 'token':
        code = generateId()
        break
    }
  }

  const payload: NewToken = {
    id: generateId(),
    userId: userId,
    type,
    ephemeral,
    expires: new Date(Date.now() + TOKEN_TTL_MS),
  }

  if (hashed) {
    payload.hash = hashSecret(code)
  } else {
    payload.value = code
  }

  await db.insert(tokens).values(payload)

  return code
}

/**
 * Why a token was refused. Expiry is reported separately so the caller can
 * tell the user to request a fresh code rather than doubt what they typed —
 * it says nothing an attacker couldn't learn by waiting.
 */
export type TokenValidation = 'valid' | 'invalid' | 'expired'

function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function validateServerToken(
  input: string,
  type: Token['type'],
  userId: User['id'],
): Promise<TokenValidation> {
  const matchingTokens = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.type, type), eq(tokens.userId, userId)))

  const hash = hashSecret(input)
  const now = new Date()

  for (let existing of matchingTokens) {
    if (existing.hash && hashesMatch(existing.hash, hash)) {
      // A code past its expiry is refused and cleared, so an OTP that surfaces
      // later — an old email, a synced inbox — never buys a session.
      if (existing.expires && new Date(existing.expires) <= now) {
        await db.delete(tokens).where(eq(tokens.id, existing.id))
        return 'expired'
      }
      if (existing.ephemeral) {
        await db.delete(tokens).where(eq(tokens.id, existing.id))
      }
      return 'valid'
    }
  }

  return 'invalid'
}
