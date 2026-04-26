import Elysia, { t } from 'elysia'
import {
  resolveLocalUser,
  processFederationMessage,
  type FederationMessage,
} from '../services/federation.service'
import {
  buildServerManifest,
  getSupportedProtocolVersions,
} from '../lib/server-identity'
import {
  verifyInboundRequest,
  getOurServerId,
} from '../services/federation-auth.service'
import { canonicalJsonStringify } from '../lib/federation-canonical'
import { logger } from '../lib/logger'
import { federationRateLimit } from '../middleware/rate-limit.middleware'

const app = new Elysia()

app.use(federationRateLimit)

/**
 * Server identity manifest
 * GET /.well-known/parchment-server
 * Published for peer servers to discover our identity key, supported protocol
 * versions, and capabilities.
 */
app.get(
  '/.well-known/parchment-server',
  () => buildServerManifest(getOurServerId()),
  {
    detail: {
      tags: ['Federation'],
      description:
        'Publish this server\'s identity key, supported protocol versions, and capabilities',
    },
  },
)

/**
 * Well-known endpoint for user discovery
 * GET /.well-known/user/:alias
 * Returns public identity info for cross-server resolution
 */
app.get(
  '/.well-known/user/:alias',
  async ({ params: { alias }, status, t }) => {
    const userInfo = await resolveLocalUser(alias)

    if (!userInfo) {
      return status(404, { message: t('errors.notFound.user') })
    }

    return userInfo
  },
  {
    params: t.Object({
      alias: t.String(),
    }),
    detail: {
      tags: ['Federation'],
      description: 'Resolve a user by their alias for federation purposes',
    },
  },
)

/**
 * Federation inbox endpoint
 * POST /federation/inbox
 * Receives signed messages from other servers. Verifies the sender server's
 * signature (S2S auth + replay protection) before delegating to the message
 * handler for the client-level signature check.
 */
app.post(
  '/federation/inbox',
  async ({ body, request, status, set }) => {
    // S2S authentication: verify the server-level signature over a
    // canonicalized body hash. Sender uses canonicalJsonStringify too, so
    // the hash is stable regardless of how each side's JSON parser orders
    // keys.
    const bodyJson = canonicalJsonStringify(body)
    try {
      const auth = await verifyInboundRequest({
        method: request.method,
        path: '/federation/inbox',
        bodyJson,
        headers: request.headers,
      })
      logger.debug(
        { sender: auth.senderServerId, protocolVersion: auth.protocolVersion },
        'Inbound federation request authenticated',
      )
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        'Inbound federation request failed S2S auth',
      )
      return status(401, {
        message: `Federation auth failed: ${(err as Error).message}`,
        supported_protocol_versions: getSupportedProtocolVersions(),
      })
    }

    const message = body as FederationMessage
    const result = await processFederationMessage(message)

    if (!result.success) {
      return status(400, {
        message: result.error || 'Failed to process message',
      })
    }

    set.status = 202
    return { success: true }
  },
  {
    body: t.Object({
      // v2 fields (preferred)
      protocol_version: t.Optional(t.Number()),
      message_type: t.Optional(t.String()),
      message_version: t.Optional(t.Number()),
      nonce: t.Optional(t.String()),
      // v1 fields (legacy; retained for transition)
      type: t.Optional(t.String()),
      from: t.String(),
      to: t.String(),
      timestamp: t.String(),
      signature: t.String(),
      payload: t.Optional(t.Record(t.String(), t.Unknown())),
    }),
    detail: {
      tags: ['Federation'],
      description: 'Receive federation messages from other servers',
    },
  },
)

export default app
