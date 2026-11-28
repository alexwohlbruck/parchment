import { eq } from 'drizzle-orm'
import { db } from '../db'
import { generateId } from '../util'
import { origins } from '../config'
import {
  oauthAuthorizationCodes,
  oauthClients,
  type OAuthClient,
} from '../schema/oauth.schema'
import { generateSecret, hashSecret } from '../lib/auth/secret-hash'
import { isValidCodeChallenge, verifyPkce } from '../lib/auth/pkce'
import { isAllowedRedirectUri, redirectUriMatches, withQuery } from '../lib/auth/redirect-uri'
import { isTokenScope, parseScopes } from '../lib/auth/token-scopes'
import { issueOAuthTokens, type IssuedOAuthTokens } from './access-token.service'
import { TOKEN_SCOPES, type TokenScope } from '../types/access-token.types'

const CODE_TTL_MS = 5 * 60 * 1000
const MAX_REDIRECT_URIS = 10

export const issuer = () => origins.serverOrigin!
export const mcpResource = () => `${issuer()}/mcp`
export const mcpResourceMetadataUrl = () => `${issuer()}/.well-known/oauth-protected-resource/mcp`

/** RFC 9728 */
export function protectedResourceMetadata(resource: string) {
  return {
    resource,
    authorization_servers: [issuer()],
    scopes_supported: [...TOKEN_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Parchment',
  }
}

/** RFC 8414 */
export function authorizationServerMetadata() {
  const base = issuer()
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    scopes_supported: [...TOKEN_SCOPES],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
  }
}

/** The audiences a client may ask a token for (RFC 8707). */
export function isOwnResource(resource: string): boolean {
  const trimmed = resource.replace(/\/$/, '')
  return trimmed === issuer() || trimmed === mcpResource()
}

export class OAuthError extends Error {
  constructor(
    readonly error: string,
    description: string,
    readonly status = 400,
  ) {
    super(description)
  }

  toJSON() {
    return { error: this.error, error_description: this.message }
  }
}

/** An error the client hears about at its own redirect URI, which is known to be registered. */
export class RedirectedOAuthError extends OAuthError {
  constructor(
    error: string,
    description: string,
    readonly redirectTo: string,
  ) {
    super(error, description)
  }
}

export interface AuthorizationParams {
  client_id?: string
  redirect_uri?: string
  response_type?: string
  code_challenge?: string
  code_challenge_method?: string
  scope?: string
  state?: string
  resource?: string
}

export interface AuthorizationRequest {
  client: OAuthClient
  redirectUri: string
  codeChallenge: string
  scopes: TokenScope[]
  state?: string
  resource?: string
}

/** Checks an authorization request the way RFC 6749 §4.1.2.1 orders it: client and redirect first, then everything else. */
export async function resolveAuthorizationRequest(params: AuthorizationParams): Promise<AuthorizationRequest> {
  if (!params.client_id || !params.redirect_uri) {
    throw new OAuthError('invalid_request', 'client_id and redirect_uri are required')
  }
  const client = await clientForRedirect(params.client_id, params.redirect_uri)
  const fail = (error: string, description: string) =>
    new RedirectedOAuthError(
      error,
      description,
      withQuery(params.redirect_uri!, {
        error,
        error_description: description,
        state: params.state,
        iss: issuer(),
      }),
    )

  if (params.response_type !== 'code') throw fail('unsupported_response_type', 'Only the code flow is supported')
  if (params.code_challenge_method !== 'S256' || !params.code_challenge || !isValidCodeChallenge(params.code_challenge)) {
    throw fail('invalid_request', 'PKCE with an S256 code_challenge is required')
  }
  if (params.resource && !isOwnResource(params.resource)) {
    throw fail('invalid_target', 'Tokens can only be issued for this server')
  }
  const scopes = params.scope === undefined || params.scope.trim() === '' ? [...TOKEN_SCOPES] : parseScopes(params.scope)
  if (!scopes.length) throw fail('invalid_scope', 'None of the requested scopes are supported')

  return {
    client,
    redirectUri: params.redirect_uri,
    codeChallenge: params.code_challenge,
    scopes,
    state: params.state,
    resource: params.resource,
  }
}

/** Where to send the user once they deny or approve. */
export function authorizationRedirect(
  request: Pick<AuthorizationRequest, 'redirectUri' | 'state'>,
  result: { code: string } | { error: string },
): string {
  return withQuery(request.redirectUri, { ...result, state: request.state, iss: issuer() })
}

export async function registerClient(input: {
  name?: string
  redirectUris: string[]
  clientUri?: string
}): Promise<OAuthClient> {
  const { redirectUris } = input
  if (!redirectUris.length || redirectUris.length > MAX_REDIRECT_URIS) {
    throw new OAuthError('invalid_redirect_uri', `Register between 1 and ${MAX_REDIRECT_URIS} redirect URIs`)
  }
  const rejected = redirectUris.find((uri) => !isAllowedRedirectUri(uri))
  if (rejected) throw new OAuthError('invalid_redirect_uri', `Redirect URI not allowed: ${rejected}`)

  const [client] = await db
    .insert(oauthClients)
    .values({
      id: generateId(),
      name: input.name?.trim().slice(0, 100) || new URL(redirectUris[0]).host || 'MCP client',
      redirectUris,
      clientUri: input.clientUri,
    })
    .returning()
  return client
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const [client] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId))
  return client ?? null
}

/** The client, if `redirectUri` is one it registered. Anything else must never be redirected to. */
export async function clientForRedirect(clientId: string, redirectUri: string): Promise<OAuthClient> {
  const client = await getClient(clientId)
  if (!client) throw new OAuthError('invalid_client', 'Unknown client')
  if (!client.redirectUris.some((registered) => redirectUriMatches(registered, redirectUri))) {
    throw new OAuthError('invalid_request', 'Redirect URI was not registered for this client')
  }
  return client
}

export async function createAuthorizationCode(input: {
  clientId: string
  userId: string
  redirectUri: string
  codeChallenge: string
  scopes: TokenScope[]
  resource?: string
}): Promise<string> {
  const code = generateSecret('')
  await db.insert(oauthAuthorizationCodes).values({
    codeHash: hashSecret(code),
    clientId: input.clientId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    scopes: input.scopes,
    resource: input.resource,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  })
  return code
}

/** Redeems a code once. Every failure is `invalid_grant`, so a caller learns nothing about which check failed. */
export async function exchangeAuthorizationCode(input: {
  code: string
  clientId: string
  redirectUri: string
  codeVerifier: string
}): Promise<IssuedOAuthTokens> {
  const [stored] = await db
    .delete(oauthAuthorizationCodes)
    .where(eq(oauthAuthorizationCodes.codeHash, hashSecret(input.code)))
    .returning()
  const invalid = new OAuthError('invalid_grant', 'The authorization code is invalid or expired')
  if (!stored || stored.expiresAt <= new Date()) throw invalid
  if (stored.clientId !== input.clientId || stored.redirectUri !== input.redirectUri) throw invalid
  if (!verifyPkce(input.codeVerifier, stored.codeChallenge)) throw invalid

  const client = await getClient(stored.clientId)
  if (!client) throw invalid
  return issueOAuthTokens(stored.userId, client, stored.scopes.filter(isTokenScope))
}
