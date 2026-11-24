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
import { parseHandle } from '../lib/crypto'
import { logger } from '../lib/logger'
import { federationRateLimit } from '../middleware/rate-limit.middleware'
import { i18nPlugin } from '../lib/i18n/plugin'

const app = new Elysia().use(i18nPlugin)

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
    let auth: Awaited<ReturnType<typeof verifyInboundRequest>>
    try {
      auth = await verifyInboundRequest({
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
        message: 'Federation auth failed',
        supported_protocol_versions: getSupportedProtocolVersions(),
      })
    }

    const message = body as FederationMessage

    const senderDomain = parseHandle(message.from)?.domain.toLowerCase()
    if (senderDomain !== auth.senderServerId.toLowerCase()) {
      logger.warn(
        { sender: auth.senderServerId, from: message.from },
        'Federation message sender is not hosted by the sending server',
      )
      return status(401, { message: 'Sender is not hosted by this server' })
    }
    if (auth.nonce !== message.nonce) {
      return status(401, { message: 'Transport nonce must match message nonce' })
    }

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
      protocol_version: t.Number({ minimum: 2 }),
      message_type: t.String(),
      message_version: t.Number(),
      nonce: t.String({ maxLength: 64 }),
      from: t.String({ maxLength: 320 }),
      to: t.String({ maxLength: 320 }),
      timestamp: t.String({ maxLength: 40 }),
      signature: t.String({ maxLength: 256 }),
      payload: t.Record(t.String(), t.Unknown()),
    }),
    detail: {
      tags: ['Federation'],
      description:
        'Receive a v2 federation message from another server. The request must carry a valid server signature, the `from` handle must live on the sending server, and the transport nonce must equal the message nonce so each user-signed message is accepted once.',
    },
  },
)

export default app
