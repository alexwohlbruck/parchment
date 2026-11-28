import Elysia, { t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { byIp, rateLimitHandler } from '../middleware/rate-limit.middleware'
import { i18nPlugin } from '../lib/i18n/plugin'
import { origins } from '../config'
import { parseScopes } from '../lib/auth/token-scopes'
import {
  authorizationRedirect,
  authorizationServerMetadata,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  getClient,
  isOwnResource,
  mcpResource,
  OAuthError,
  protectedResourceMetadata,
  RedirectedOAuthError,
  registerClient,
  resolveAuthorizationRequest,
  type AuthorizationParams,
} from '../services/oauth.service'
import {
  refreshOAuthTokens,
  revokeOAuthSecret,
  type IssuedOAuthTokens,
} from '../services/access-token.service'
import type { AuthorizationRequestDetails } from '../types/access-token.types'

const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' }

const registerLimit = rateLimitHandler({ name: 'oauth-register', limit: 20, windowMs: 60 * 60_000 }, byIp)
const tokenLimit = rateLimitHandler({ name: 'oauth-token', limit: 60 }, byIp)

const authorizationParams = t.Object({
  client_id: t.Optional(t.String()),
  redirect_uri: t.Optional(t.String()),
  response_type: t.Optional(t.String()),
  code_challenge: t.Optional(t.String()),
  code_challenge_method: t.Optional(t.String()),
  scope: t.Optional(t.String()),
  state: t.Optional(t.String()),
  resource: t.Optional(t.String()),
})

function oauthFailure(error: unknown, set: { status?: number | string; headers: Record<string, any> }) {
  if (!(error instanceof OAuthError)) throw error
  set.status = error.status
  Object.assign(set.headers, NO_STORE)
  return error.toJSON()
}

function tokenResponse(tokens: IssuedOAuthTokens) {
  return {
    access_token: tokens.accessToken,
    token_type: 'Bearer',
    expires_in: tokens.expiresIn,
    refresh_token: tokens.refreshToken,
    scope: tokens.scopes.join(' '),
  }
}

const required = (value: string | undefined, name: string) => {
  if (!value) throw new OAuthError('invalid_request', `${name} is required`)
  return value
}

async function grantTokens(body: Record<string, string | undefined>): Promise<IssuedOAuthTokens> {
  const clientId = required(body.client_id, 'client_id')
  if (!(await getClient(clientId))) throw new OAuthError('invalid_client', 'Unknown client', 401)
  if (body.resource && !isOwnResource(body.resource)) {
    throw new OAuthError('invalid_target', 'Tokens can only be issued for this server')
  }

  switch (body.grant_type) {
    case 'authorization_code':
      return exchangeAuthorizationCode({
        code: required(body.code, 'code'),
        clientId,
        redirectUri: required(body.redirect_uri, 'redirect_uri'),
        codeVerifier: required(body.code_verifier, 'code_verifier'),
      })
    case 'refresh_token': {
      const tokens = await refreshOAuthTokens(required(body.refresh_token, 'refresh_token'), clientId)
      if (!tokens) throw new OAuthError('invalid_grant', 'The refresh token is invalid or expired')
      return tokens
    }
    default:
      throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token')
  }
}

/** The consent screen's half of authorization, which needs the user's own session. */
const consent = new Elysia()
  .use(i18nPlugin)
  .use(requireAuth)
  .get(
    '/oauth/authorize/request',
    async ({ query, set }) => {
      try {
        const request = await resolveAuthorizationRequest(query)
        const details: AuthorizationRequestDetails = {
          client: {
            id: request.client.id,
            name: request.client.name,
            redirectHost: new URL(request.redirectUri).host || request.redirectUri,
          },
          scopes: request.scopes,
          denyUrl: authorizationRedirect(request, { error: 'access_denied' }),
        }
        return details
      } catch (error) {
        if (error instanceof RedirectedOAuthError) {
          set.status = 400
          return { ...error.toJSON(), redirectTo: error.redirectTo }
        }
        return oauthFailure(error, set)
      }
    },
    {
      query: authorizationParams,
      detail: {
        tags: ['OAuth'],
        summary: 'Describe an authorization request',
        description:
          'What the consent screen shows: the client, the scopes it asked for (all of them when it named none), and where to send the user if they decline.',
      },
    },
  )
  .post(
    '/oauth/authorize',
    async ({ body, user, set }) => {
      try {
        const scopes = parseScopes(body.scope)
        if (!scopes.length) throw new OAuthError('invalid_scope', 'Approve at least one scope')
        const request = await resolveAuthorizationRequest(body)
        const code = await createAuthorizationCode({
          clientId: request.client.id,
          userId: user.id,
          redirectUri: request.redirectUri,
          codeChallenge: request.codeChallenge,
          scopes,
          resource: request.resource,
        })
        return { redirectTo: authorizationRedirect(request, { code }) }
      } catch (error) {
        if (error instanceof RedirectedOAuthError) return { redirectTo: error.redirectTo }
        return oauthFailure(error, set)
      }
    },
    {
      body: authorizationParams,
      detail: {
        tags: ['OAuth'],
        summary: 'Approve an authorization request',
        description:
          'Called by the consent screen with the original request and the scopes the user approved in `scope`. Returns the client redirect carrying a single-use code, valid for 5 minutes.',
      },
    },
  )

const app = new Elysia()
  .use(i18nPlugin)

  .get('/.well-known/oauth-protected-resource', () => protectedResourceMetadata(origins.serverOrigin!), {
    detail: {
      tags: ['OAuth'],
      summary: 'Protected resource metadata for the API',
      description: 'RFC 9728 metadata naming this server as the authorization server and listing the scopes a token can hold.',
    },
  })

  .get('/.well-known/oauth-protected-resource/mcp', () => protectedResourceMetadata(mcpResource()), {
    detail: {
      tags: ['OAuth'],
      summary: 'Protected resource metadata for MCP',
      description: 'RFC 9728 metadata for the `/mcp` endpoint. Its URL is the `resource_metadata` in the `WWW-Authenticate` header of a 401 from `/mcp`.',
    },
  })

  .get('/.well-known/oauth-authorization-server', () => authorizationServerMetadata(), {
    detail: {
      tags: ['OAuth'],
      summary: 'Authorization server metadata',
      description: 'RFC 8414 metadata. Authorization code with PKCE (S256) and refresh tokens; every client is public and registers itself.',
    },
  })

  .post(
    '/oauth/register',
    async ({ body, set }) => {
      try {
        const client = await registerClient({
          name: body.client_name,
          redirectUris: body.redirect_uris ?? [],
          clientUri: body.client_uri,
        })
        set.status = 201
        Object.assign(set.headers, NO_STORE)
        return {
          client_id: client.id,
          client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
          client_name: client.name,
          redirect_uris: client.redirectUris,
          ...(client.clientUri && { client_uri: client.clientUri }),
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        }
      } catch (error) {
        return oauthFailure(error, set)
      }
    },
    {
      beforeHandle: registerLimit,
      body: t.Object({
        redirect_uris: t.Optional(t.Array(t.String())),
        client_name: t.Optional(t.String()),
        client_uri: t.Optional(t.String()),
      }),
      detail: {
        tags: ['OAuth'],
        summary: 'Register a client',
        description:
          'RFC 7591 dynamic client registration. Clients are registered as public (`token_endpoint_auth_method: none`) whatever they ask for. Redirect URIs must be HTTPS, loopback HTTP, or an app scheme.',
      },
    },
  )

  .get(
    '/oauth/authorize',
    async ({ query, request, redirect, set }) => {
      try {
        await resolveAuthorizationRequest(query)
        return redirect(`${origins.clientOrigin}/oauth/authorize${new URL(request.url).search}`, 302)
      } catch (error) {
        if (error instanceof RedirectedOAuthError) return redirect(error.redirectTo, 302)
        return oauthFailure(error, set)
      }
    },
    {
      query: authorizationParams,
      detail: {
        tags: ['OAuth'],
        summary: 'Start authorization',
        description:
          'Checks the request and sends the user to the consent screen in the web app. A bad client or redirect URI answers 400 here; any other problem is reported to the redirect URI.',
      },
    },
  )

  .use(consent)

  .post(
    '/oauth/token',
    async ({ body, set }) => {
      try {
        const tokens = await grantTokens(body)
        Object.assign(set.headers, NO_STORE)
        return tokenResponse(tokens)
      } catch (error) {
        return oauthFailure(error, set)
      }
    },
    {
      beforeHandle: tokenLimit,
      body: t.Object({
        grant_type: t.Optional(t.String()),
        client_id: t.Optional(t.String()),
        code: t.Optional(t.String()),
        redirect_uri: t.Optional(t.String()),
        code_verifier: t.Optional(t.String()),
        refresh_token: t.Optional(t.String()),
        resource: t.Optional(t.String()),
      }),
      detail: {
        tags: ['OAuth'],
        summary: 'Exchange a code or refresh token',
        description:
          'Form-encoded or JSON. `authorization_code` needs `code`, `redirect_uri`, `client_id` and the PKCE `code_verifier`; `refresh_token` needs `refresh_token` and `client_id`. Access tokens last an hour. Each refresh returns a new refresh token and retires the old pair.',
      },
    },
  )

  .post(
    '/oauth/revoke',
    async ({ body }) => {
      if (body.token && body.client_id) await revokeOAuthSecret(body.token, body.client_id)
      return new Response(null, { status: 200 })
    },
    {
      body: t.Object({
        token: t.Optional(t.String()),
        token_type_hint: t.Optional(t.String()),
        client_id: t.Optional(t.String()),
      }),
      detail: {
        tags: ['OAuth'],
        summary: 'Revoke a token',
        description: 'RFC 7009. Revoking the access or the refresh token ends the whole grant. Always answers 200.',
      },
    },
  )

export default app
