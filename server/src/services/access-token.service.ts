import { and, desc, eq, or, gt } from 'drizzle-orm'
import { db } from '../db'
import { generateId } from '../util'
import { accessTokens, type AccessToken } from '../schema/access-tokens.schema'
import { generateSecret, hashSecret } from '../lib/auth/secret-hash'
import { isTokenScope } from '../lib/auth/token-scopes'
import type {
  AccessTokenSummary,
  CreatedAccessToken,
  PersonalTokenLifetime,
  TokenGrant,
  TokenScope,
} from '../types/access-token.types'

export const PERSONAL_TOKEN_PREFIX = 'pat_'
export const OAUTH_ACCESS_PREFIX = 'oat_'
export const OAUTH_REFRESH_PREFIX = 'ort_'

export const OAUTH_ACCESS_TTL_S = 60 * 60
const OAUTH_REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000
const LAST_USED_RESOLUTION_MS = 5 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const HINT_LENGTH = 10

export function isScopedTokenSecret(secret: string): boolean {
  return secret.startsWith(PERSONAL_TOKEN_PREFIX) || secret.startsWith(OAUTH_ACCESS_PREFIX)
}

function hintOf(secret: string) {
  return secret.slice(0, HINT_LENGTH)
}

function knownScopes(scopes: string[]): TokenScope[] {
  return scopes.filter(isTokenScope)
}

function summarize(row: AccessToken): AccessTokenSummary {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    scopes: knownScopes(row.scopes),
    hint: row.hint,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.kind === 'oauth' ? row.refreshExpiresAt : row.expiresAt,
  }
}

export async function createPersonalToken(
  userId: string,
  name: string,
  scopes: TokenScope[],
  lifetimeDays: PersonalTokenLifetime,
): Promise<CreatedAccessToken> {
  const secret = generateSecret(PERSONAL_TOKEN_PREFIX)
  const [row] = await db
    .insert(accessTokens)
    .values({
      id: generateId(),
      userId,
      kind: 'personal',
      name,
      scopes,
      tokenHash: hashSecret(secret),
      hint: hintOf(secret),
      expiresAt: lifetimeDays === null ? null : new Date(Date.now() + lifetimeDays * DAY_MS),
    })
    .returning()
  return { ...summarize(row), secret }
}

export async function listAccessTokens(userId: string): Promise<AccessTokenSummary[]> {
  const rows = await db
    .select()
    .from(accessTokens)
    .where(eq(accessTokens.userId, userId))
    .orderBy(desc(accessTokens.createdAt))
  const now = Date.now()
  return rows
    .map(summarize)
    .filter((token) => !token.expiresAt || token.expiresAt.getTime() > now)
}

/** True when a token of this user's was removed. */
export async function revokeAccessToken(userId: string, tokenId: string): Promise<boolean> {
  const removed = await db
    .delete(accessTokens)
    .where(and(eq(accessTokens.id, tokenId), eq(accessTokens.userId, userId)))
    .returning({ id: accessTokens.id })
  return removed.length > 0
}

/** The grant behind a bearer secret, or null if it is unknown or expired. */
export async function authenticateAccessToken(secret: string): Promise<TokenGrant | null> {
  if (!isScopedTokenSecret(secret)) return null
  const [row] = await db
    .select()
    .from(accessTokens)
    .where(eq(accessTokens.tokenHash, hashSecret(secret)))
  if (!row) return null
  const now = new Date()
  if (row.expiresAt && row.expiresAt <= now) return null

  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    await db.update(accessTokens).set({ lastUsedAt: now }).where(eq(accessTokens.id, row.id))
  }
  return { tokenId: row.id, userId: row.userId, scopes: knownScopes(row.scopes), expiresAt: row.expiresAt }
}

export interface IssuedOAuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
  scopes: TokenScope[]
}

function freshOAuthSecrets() {
  const accessToken = generateSecret(OAUTH_ACCESS_PREFIX)
  const refreshToken = generateSecret(OAUTH_REFRESH_PREFIX)
  const now = Date.now()
  return {
    accessToken,
    refreshToken,
    columns: {
      tokenHash: hashSecret(accessToken),
      hint: hintOf(accessToken),
      expiresAt: new Date(now + OAUTH_ACCESS_TTL_S * 1000),
      refreshHash: hashSecret(refreshToken),
      refreshExpiresAt: new Date(now + OAUTH_REFRESH_TTL_MS),
    },
  }
}

export async function issueOAuthTokens(
  userId: string,
  client: { id: string; name: string },
  scopes: TokenScope[],
): Promise<IssuedOAuthTokens> {
  const { accessToken, refreshToken, columns } = freshOAuthSecrets()
  await db.insert(accessTokens).values({
    id: generateId(),
    userId,
    kind: 'oauth',
    name: client.name,
    clientId: client.id,
    scopes,
    ...columns,
  })
  return { accessToken, refreshToken, expiresIn: OAUTH_ACCESS_TTL_S, scopes }
}

/** Swaps a refresh token for a new pair; the old pair stops working. Null if it is unknown, expired or another client's. */
export async function refreshOAuthTokens(
  refreshToken: string,
  clientId: string,
): Promise<IssuedOAuthTokens | null> {
  if (!refreshToken.startsWith(OAUTH_REFRESH_PREFIX)) return null
  const { accessToken, refreshToken: nextRefresh, columns } = freshOAuthSecrets()
  const [row] = await db
    .update(accessTokens)
    .set(columns)
    .where(
      and(
        eq(accessTokens.refreshHash, hashSecret(refreshToken)),
        eq(accessTokens.clientId, clientId),
        gt(accessTokens.refreshExpiresAt, new Date()),
      ),
    )
    .returning()
  if (!row) return null
  return {
    accessToken,
    refreshToken: nextRefresh,
    expiresIn: OAUTH_ACCESS_TTL_S,
    scopes: knownScopes(row.scopes),
  }
}

/** RFC 7009: revoking either half of an OAuth pair ends the grant. */
export async function revokeOAuthSecret(secret: string, clientId: string): Promise<void> {
  const hash = hashSecret(secret)
  await db
    .delete(accessTokens)
    .where(
      and(
        eq(accessTokens.clientId, clientId),
        or(eq(accessTokens.tokenHash, hash), eq(accessTokens.refreshHash, hash)),
      ),
    )
}
