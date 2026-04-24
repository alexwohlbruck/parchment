import Elysia, { t } from 'elysia'
import { randomUUID } from 'node:crypto'
import { requireAuth } from '../middleware/auth.middleware'
import {
  add as registerSocket,
  removeById as deregisterSocket,
  connectedUserCount,
  totalSocketCount,
} from '../services/realtime/registry.service'
import {
  mintTicket,
  redeemTicket,
} from '../services/realtime/ticket.service'
import { logger } from '../lib/logger'

/**
 * Realtime controller: WS endpoint + the ticket-mint endpoint the client
 * uses to authenticate its upgrade.
 *
 * Why tickets (see ticket.service.ts for context): browsers can't set
 * Authorization headers on WS handshakes, and cross-origin cookie posture
 * in dev is fragile. An HTTP POST with the normal session auth mints a
 * 30-second single-use ticket; the client passes it as `?ticket=…` on the
 * WS URL and the upgrade handler redeems it. One round-trip, no hacks.
 *
 * NOTE: the WS route is registered on its own Elysia instance that does NOT
 * use `requireAuth`. `.use(requireAuth)` mutates the instance in place and
 * would cause every subsequent route — including `.ws()` — to 401 on any
 * request without a Bearer/cookie, which browsers can't set during a WS
 * upgrade handshake. The ticket endpoints live on a second instance that
 * DOES require auth; both are merged via `.use(...)` below.
 */

const httpApi = new Elysia({ prefix: '/realtime' })

/**
 * POST /realtime/ticket → { ticket, expiresAt }
 *
 * Standard session auth required. Returns a short-lived opaque token the
 * client must send with the WS upgrade.
 */
httpApi.use(requireAuth).post(
  '/ticket',
  ({ user }) => {
    return mintTicket(user.id)
  },
  {
    detail: {
      tags: ['Realtime'],
      summary: 'Mint a short-lived WebSocket upgrade ticket',
    },
  },
)

/**
 * GET /realtime/stats → diagnostic counters. Gated behind auth so we don't
 * leak connection state to anonymous scrapers. Useful for /health-style
 * checks without exposing the registry directly.
 */
httpApi.use(requireAuth).get(
  '/stats',
  () => ({
    connectedUsers: connectedUserCount(),
    totalSockets: totalSocketCount(),
  }),
  {
    detail: {
      tags: ['Realtime'],
      summary: 'WebSocket connection counters',
    },
  },
)

/**
 * WS /realtime?ticket=… lives on a separate instance so it doesn't inherit
 * the HTTP-side `requireAuth` chain — ticket redemption is the auth step
 * for this path.
 *
 * Close codes:
 *   - 1008 Policy violation (no/bad ticket)
 *   - 1011 Internal error (registry failure)
 *   - 1000 Normal closure (client-initiated, or server shutdown)
 */
const wsApi = new Elysia({ prefix: '/realtime' })

/**
 * We mint a `connectionId` in `beforeHandle` and stash it (along with the
 * resolved userId) on the query object that Elysia passes through to the
 * WS lifecycle. The open handler reads both to register the connection;
 * the close handler reads only the id to deregister.
 *
 * Why not a WeakMap keyed by `ws`? Elysia constructs a fresh `ElysiaWS`
 * wrapper per handler invocation, so the `ws` identity differs between
 * `open` and `close`. Matching on a stable string id sidesteps that.
 */
interface WsQueryCarrier {
  _connectionId?: string
  _userId?: string
}

wsApi.ws('/', {
  query: t.Object({
    ticket: t.String(),
  }),
  beforeHandle({ query, set }) {
    const userId = redeemTicket(query.ticket)
    if (!userId) {
      set.status = 401
      return 'Invalid or expired ticket'
    }
    const carrier = query as unknown as WsQueryCarrier
    carrier._userId = userId
    carrier._connectionId = `conn_${randomUUID()}`
  },
  open(ws) {
    const carrier = ws.data.query as unknown as WsQueryCarrier | undefined
    const userId = carrier?._userId
    const connectionId = carrier?._connectionId
    if (!userId || !connectionId) {
      try {
        ws.close(1011, 'Missing session state on open')
      } catch {
        /* already closed */
      }
      return
    }
    registerSocket(userId, {
      id: connectionId,
      send: (data) => ws.send(data),
      close: (code, reason) => ws.close(code, reason),
    })
    logger.debug({ userId, connectionId }, 'Realtime WS opened')
  },
  close(ws, code, reason) {
    const carrier = ws.data.query as unknown as WsQueryCarrier | undefined
    const connectionId = carrier?._connectionId
    if (connectionId) deregisterSocket(connectionId)
    logger.debug({ code, reason, connectionId }, 'Realtime WS closed')
  },
  error({ error }) {
    // Elysia surfaces upgrade errors here; per-message errors go to the
    // caller's onmessage. We log but don't rethrow — the socket is gone.
    logger.debug({ err: error }, 'Realtime WS error')
  },
})

const app = new Elysia().use(httpApi).use(wsApi)

export default app
