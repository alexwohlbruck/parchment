import { Elysia, t } from 'elysia'
import { optionalAuth } from '../middleware/auth.middleware'
import { i18nPlugin } from '../lib/i18n/plugin'
import { getPermissions, hasPermission } from '../services/auth.service'
import {
  deniedToolCall,
  handleMcpRequest,
  rpcError,
  RpcErrorCode,
} from '../services/ask/ask-mcp.service'
import { mcpResourceMetadataUrl } from '../services/oauth.service'
import { formatScopes, insufficientScopeChallenge } from '../lib/auth/token-scopes'
import { TOKEN_SCOPES } from '../types/access-token.types'
import { PermissionId } from '../types/auth.types'
import { getAskPreferences } from '../services/user-preferences.service'
import type { JsonRpcRequest } from '../types/mcp.types'

const methodNotAllowed = () =>
  new Response(null, { status: 405, headers: { Allow: 'POST' } })

const app = new Elysia()
  .use(i18nPlugin)
  .use(optionalAuth)

  .post(
    '/mcp',
    async ({ body, user, scopes, language, request, set, status, t }) => {
      if (!user) {
        set.headers['www-authenticate'] =
          `Bearer resource_metadata="${mcpResourceMetadataUrl()}", scope="${formatScopes(TOKEN_SCOPES)}"`
        return status(401, rpcError(null, RpcErrorCode.UNAUTHORIZED, t('errors.auth.unauthorized')))
      }
      if (!hasPermission(await getPermissions(user.id), PermissionId.PREMIUM_ASK)) {
        return status(403, rpcError(null, RpcErrorCode.FORBIDDEN, t('errors.auth.forbidden')))
      }
      if (!(await getAskPreferences(user.id)).enabled) {
        return status(403, rpcError(null, RpcErrorCode.FORBIDDEN, t('errors.ask.turnedOff')))
      }

      if (body.method === undefined || body.id === undefined) {
        return new Response(null, { status: 202 })
      }
      if (body.id === null) {
        return status(400, rpcError(null, RpcErrorCode.INVALID_REQUEST, 'Request id must not be null'))
      }

      const denied = deniedToolCall(body as JsonRpcRequest, scopes)
      if (denied) {
        set.headers['www-authenticate'] =
          `${insufficientScopeChallenge(denied.scope)}, resource_metadata="${mcpResourceMetadataUrl()}"`
        return status(403, rpcError(body.id, RpcErrorCode.FORBIDDEN, t('errors.auth.tokenScope')))
      }

      return handleMcpRequest(body as JsonRpcRequest, {
        userId: user.id,
        language,
        scopes,
        signal: request.signal,
      })
    },
    {
      body: t.Object({
        jsonrpc: t.Literal('2.0'),
        id: t.Optional(t.Union([t.String(), t.Number(), t.Null()])),
        method: t.Optional(t.String()),
        params: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
      detail: {
        tags: ['Ask'],
        summary: 'Model Context Protocol endpoint',
        description:
          "A stateless MCP server (Streamable HTTP, JSON responses) exposing Ask's tools to MCP clients such as Claude or ChatGPT: place search and details, what is at a point, trip planning, transit departures and lines, weather and wildfires, the user's saved places, collections, routes, canvases and vehicles, and building, changing, sharing and archiving routes, canvases and saved places in their library. `tools/list` describes each. Send one JSON-RPC message per request; supports `initialize`, `ping`, `tools/list` and `tools/call`. Notifications are acknowledged with 202. Needs a signed-in user with the `premium:ask` permission and Ask turned on in their settings, by session cookie, `Authorization: Bearer <session token>`, or a scoped token: a personal access token from Settings or an OAuth access token (see `/.well-known/oauth-protected-resource/mcp`). A scoped token lists and calls only the tools its scopes cover, and a call outside them answers 403 with `WWW-Authenticate: Bearer error=\"insufficient_scope\"`. Tool results are JSON text; a failed search returns `isError: true` with the reason.",
      },
    },
  )

  .get('/mcp', methodNotAllowed, {
    detail: {
      tags: ['Ask'],
      summary: 'MCP event stream (not offered)',
      description: 'The MCP server is stateless and sends no server-initiated messages, so this always answers 405.',
    },
  })

  .delete('/mcp', methodNotAllowed, {
    detail: {
      tags: ['Ask'],
      summary: 'End an MCP session (not offered)',
      description: 'The MCP server keeps no sessions, so this always answers 405.',
    },
  })

export default app
