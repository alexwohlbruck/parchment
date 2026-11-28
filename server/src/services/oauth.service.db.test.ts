import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../schema/users.schema'
import { oauthAuthorizationCodes, oauthClients } from '../schema/oauth.schema'
import { generateId } from '../util'
import { s256Challenge } from '../lib/auth/pkce'
import { authenticateAccessToken } from './access-token.service'
import {
  createAuthorizationCode,
  exchangeAuthorizationCode,
  OAuthError,
  registerClient,
  resolveAuthorizationRequest,
  RedirectedOAuthError,
} from './oauth.service'

const RUN = Math.random().toString(36).slice(2, 8)
const userId = generateId()
const verifier = 'a'.repeat(20) + RUN.padEnd(30, 'b')
const redirectUri = 'https://claude.ai/api/mcp/auth_callback'
let clientId = ''

beforeAll(async () => {
  await db.insert(users).values({
    id: userId,
    email: `oauth-${RUN}@parchment.test`,
    alias: `oauth_${RUN}`,
    signingKey: 'sig',
    encryptionKey: 'enc',
  })
  clientId = (await registerClient({ name: 'Claude', redirectUris: [redirectUri] })).id
})

afterAll(async () => {
  await db.delete(oauthClients).where(eq(oauthClients.id, clientId))
  await db.delete(users).where(eq(users.id, userId))
})

function newCode() {
  return createAuthorizationCode({
    clientId,
    userId,
    redirectUri,
    codeChallenge: s256Challenge(verifier),
    scopes: ['places:read', 'library:write'],
  })
}

const exchange = (code: string, overrides: Partial<Parameters<typeof exchangeAuthorizationCode>[0]> = {}) =>
  exchangeAuthorizationCode({ code, clientId, redirectUri, codeVerifier: verifier, ...overrides })

describe('authorization code exchange', () => {
  test('the right verifier gets tokens carrying the approved scopes', async () => {
    const tokens = await exchange(await newCode())
    expect(tokens.scopes).toEqual(['places:read', 'library:write'])
    expect(await authenticateAccessToken(tokens.accessToken)).toMatchObject({
      userId,
      scopes: ['places:read', 'library:write'],
    })
  })

  test('a code works once', async () => {
    const code = await newCode()
    await exchange(code)
    await expect(exchange(code)).rejects.toMatchObject({ error: 'invalid_grant' })
  })

  test('a wrong verifier burns the code', async () => {
    const code = await newCode()
    await expect(exchange(code, { codeVerifier: 'c'.repeat(43) })).rejects.toMatchObject({ error: 'invalid_grant' })
    await expect(exchange(code)).rejects.toMatchObject({ error: 'invalid_grant' })
  })

  test('the redirect URI and client must match the authorization', async () => {
    await expect(exchange(await newCode(), { redirectUri: 'https://claude.ai/other' })).rejects.toBeInstanceOf(OAuthError)
    await expect(exchange(await newCode(), { clientId: 'someone-else' })).rejects.toBeInstanceOf(OAuthError)
  })

  test('an expired code is refused', async () => {
    const code = await newCode()
    await db
      .update(oauthAuthorizationCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(oauthAuthorizationCodes.clientId, clientId))
    await expect(exchange(code)).rejects.toMatchObject({ error: 'invalid_grant' })
  })
})

describe('authorization requests', () => {
  const params = () => ({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    code_challenge: s256Challenge(verifier),
    code_challenge_method: 'S256',
    state: 'xyz',
  })

  test('asks for every scope when the client names none', async () => {
    const request = await resolveAuthorizationRequest(params())
    expect(request.scopes).toEqual(['places:read', 'trips:read', 'weather:read', 'library:read', 'library:write'])
  })

  test('never redirects to an unregistered URI', async () => {
    const attempt = resolveAuthorizationRequest({ ...params(), redirect_uri: 'https://evil.example/cb' })
    await expect(attempt).rejects.toBeInstanceOf(OAuthError)
    await expect(attempt).rejects.not.toBeInstanceOf(RedirectedOAuthError)
  })

  test('sends a request without PKCE back to the client', async () => {
    const attempt = resolveAuthorizationRequest({ ...params(), code_challenge_method: 'plain' })
    await expect(attempt).rejects.toBeInstanceOf(RedirectedOAuthError)
    await expect(attempt).rejects.toMatchObject({ redirectTo: expect.stringContaining('error=invalid_request') })
  })

  test('refuses a token for another resource', async () => {
    await expect(
      resolveAuthorizationRequest({ ...params(), resource: 'https://elsewhere.example/mcp' }),
    ).rejects.toMatchObject({ error: 'invalid_target' })
  })

  test('refuses to register an unsafe redirect URI', async () => {
    await expect(registerClient({ redirectUris: ['http://example.com/cb'] })).rejects.toMatchObject({
      error: 'invalid_redirect_uri',
    })
  })
})
