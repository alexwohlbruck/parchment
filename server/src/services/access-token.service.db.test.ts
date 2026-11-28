import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../schema/users.schema'
import { accessTokens } from '../schema/access-tokens.schema'
import { oauthClients } from '../schema/oauth.schema'
import { generateId } from '../util'
import { hashSecret } from '../lib/auth/secret-hash'
import {
  authenticateAccessToken,
  createPersonalToken,
  issueOAuthTokens,
  listAccessTokens,
  refreshOAuthTokens,
  revokeAccessToken,
  revokeOAuthSecret,
} from './access-token.service'

const RUN = Math.random().toString(36).slice(2, 8)
const userId = generateId()
const otherUserId = generateId()
const client = { id: generateId(), name: 'Claude' }

beforeAll(async () => {
  await db.insert(users).values(
    [userId, otherUserId].map((id, index) => ({
      id,
      email: `pat-${index}-${RUN}@parchment.test`,
      alias: `pat_${index}_${RUN}`,
      signingKey: 'sig',
      encryptionKey: 'enc',
    })),
  )
  await db.insert(oauthClients).values({ ...client, redirectUris: ['https://claude.ai/cb'] })
})

afterAll(async () => {
  await db.delete(oauthClients).where(eq(oauthClients.id, client.id))
  await db.delete(users).where(eq(users.id, userId))
  await db.delete(users).where(eq(users.id, otherUserId))
})

async function storedRow(id: string) {
  const [row] = await db.select().from(accessTokens).where(eq(accessTokens.id, id))
  return row
}

describe('personal access tokens', () => {
  test('stores only a hash of the secret, and finds the grant by it', async () => {
    const created = await createPersonalToken(userId, 'Laptop', ['places:read', 'library:read'], 30)
    const row = await storedRow(created.id)

    expect(created.secret).toStartWith('pat_')
    expect(row.tokenHash).toBe(hashSecret(created.secret))
    expect(Object.values(row)).not.toContain(created.secret)
    expect(created.hint).toBe(created.secret.slice(0, created.hint.length))

    const grant = await authenticateAccessToken(created.secret)
    expect(grant).toEqual({
      tokenId: created.id,
      userId,
      scopes: ['places:read', 'library:read'],
      expiresAt: row.expiresAt,
    })
    expect((await storedRow(created.id)).lastUsedAt).not.toBeNull()
  })

  test('refuses an unknown secret and one past its expiry', async () => {
    expect(await authenticateAccessToken('pat_doesnotexist')).toBeNull()

    const created = await createPersonalToken(userId, 'Old', ['places:read'], 30)
    await db
      .update(accessTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(accessTokens.id, created.id))
    expect(await authenticateAccessToken(created.secret)).toBeNull()
    expect((await listAccessTokens(userId)).map((token) => token.id)).not.toContain(created.id)
  })

  test('a token that never expires keeps working', async () => {
    const created = await createPersonalToken(userId, 'Forever', ['weather:read'], null)
    expect(created.expiresAt).toBeNull()
    expect((await authenticateAccessToken(created.secret))?.userId).toBe(userId)
  })

  test('only its owner can revoke it, and then it stops working', async () => {
    const created = await createPersonalToken(userId, 'Revoke me', ['places:read'], 90)

    expect(await revokeAccessToken(otherUserId, created.id)).toBe(false)
    expect(await authenticateAccessToken(created.secret)).not.toBeNull()

    expect(await revokeAccessToken(userId, created.id)).toBe(true)
    expect(await authenticateAccessToken(created.secret)).toBeNull()
  })
})

describe('OAuth grants', () => {
  test('a refresh swaps both secrets and retires the old pair', async () => {
    const first = await issueOAuthTokens(userId, client, ['trips:read'])
    expect(await authenticateAccessToken(first.accessToken)).not.toBeNull()

    const second = await refreshOAuthTokens(first.refreshToken, client.id)
    expect(second?.scopes).toEqual(['trips:read'])
    expect(await authenticateAccessToken(first.accessToken)).toBeNull()
    expect(await refreshOAuthTokens(first.refreshToken, client.id)).toBeNull()
    expect(await authenticateAccessToken(second!.accessToken)).not.toBeNull()
  })

  test('another client cannot use the refresh token', async () => {
    const issued = await issueOAuthTokens(userId, client, ['trips:read'])
    expect(await refreshOAuthTokens(issued.refreshToken, 'someone-else')).toBeNull()
  })

  test('revoking the refresh token ends the grant', async () => {
    const issued = await issueOAuthTokens(userId, client, ['places:read'])
    await revokeOAuthSecret(issued.refreshToken, client.id)
    expect(await authenticateAccessToken(issued.accessToken)).toBeNull()
  })

  test('is listed under the client name', async () => {
    await issueOAuthTokens(userId, client, ['places:read'])
    const listed = await listAccessTokens(userId)
    expect(listed.find((token) => token.kind === 'oauth')).toMatchObject({ name: 'Claude' })
  })
})
