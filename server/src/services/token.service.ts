import { alphabet, generateRandomString, sha256 } from 'oslo/crypto'
import { encodeHex } from 'oslo/encoding'
import { eq, and } from 'drizzle-orm'
import { db } from '../db'
import { generateId } from '../util'
import { NewToken, Token, tokens } from '../schema/tokens.schema'
import { User } from '../schema/users.schema'

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
  }

  if (hashed) {
    payload.hash = encodeHex(await sha256(new TextEncoder().encode(code)))
  } else {
    payload.value = code
  }

  await db.insert(tokens).values(payload)

  return code
}

export async function validateServerToken(
  input: string,
  type: Token['type'],
  userId: User['id'],
) {
  const matchingTokens = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.type, type), eq(tokens.userId, userId)))

  const hash = encodeHex(await sha256(new TextEncoder().encode(input)))

  for (let existing of matchingTokens) {
    if (existing.hash === hash) {
      if (existing.ephemeral) {
        await db.delete(tokens).where(eq(tokens.id, existing.id))
      }
      return true
    }
  }

  return false
}
