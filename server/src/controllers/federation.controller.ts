import Elysia, { t } from 'elysia'
import {
  resolveLocalUser,
  processFederationMessage,
  type FederationMessage,
} from '../services/federation.service'

const app = new Elysia()

/**
 * Well-known endpoint for user discovery
 * GET /.well-known/user/:alias
 * Returns public identity info for cross-server resolution
 */
app.get(
  '/.well-known/user/:alias',
  async ({ params: { alias }, set, error }) => {
    const userInfo = await resolveLocalUser(alias)

    if (!userInfo) {
      return error(404, { message: 'User not found' })
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
 * Receives signed messages from other servers
 */
app.post(
  '/federation/inbox',
  async ({ body, set, error }) => {
    const message = body as FederationMessage

    const result = await processFederationMessage(message)

    if (!result.success) {
      return error(400, { message: result.error || 'Failed to process message' })
    }

    set.status = 202
    return { success: true }
  },
  {
    body: t.Object({
      type: t.String(),
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
