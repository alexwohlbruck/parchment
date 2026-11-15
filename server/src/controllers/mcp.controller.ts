import { Elysia, t } from 'elysia'
import { optionalAuth } from '../middleware/auth.middleware'
import { i18nPlugin } from '../lib/i18n/plugin'
import { getPermissions, hasPermission } from '../services/auth.service'
import { handleMcpRequest, rpcError, RpcErrorCode } from '../services/ask/ask-mcp.service'
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
    async ({ body, user, language, request, set, status, t }) => {
      if (!user) {
        set.headers['www-authenticate'] = 'Bearer'
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

      return handleMcpRequest(body as JsonRpcRequest, {
        userId: user.id,
        language,
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
          "A stateless MCP server (Streamable HTTP, JSON responses) exposing Ask's place search tools to MCP clients such as Claude or ChatGPT: `find_places`, `find_categories`, `browse_category`, `get_place`, `locate` and `places_within_reach`. Send one JSON-RPC message per request; supports `initialize`, `ping`, `tools/list` and `tools/call`. Notifications are acknowledged with 202. Needs a signed-in user with the `premium:ask` permission and Ask turned on in their settings, by session cookie or `Authorization: Bearer <session token>`. Tool results are JSON text; a failed search returns `isError: true` with the reason.",
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
