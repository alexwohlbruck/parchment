/**
 * Short-lived WebSocket upgrade tickets.
 *
 * Browsers can't set custom headers on a WS handshake, and cross-origin
 * setups (dev especially — vite on 5174 talking to the API on 5000) don't
 * always forward cookies. Rather than hack around with `Sec-WebSocket-
 * Protocol` header abuse, we mint a single-use ticket from an already-
 * authenticated HTTP request and the client presents it as a `?ticket=…`
 * query param on the WS URL.
 *
 * Tickets:
 *   - are random 32 bytes, base64url-encoded
 *   - live for 30 seconds, one-time-use
 *   - bind to a userId; the WS controller resolves ticket → userId
 *
 * One-time-use is what keeps a leaked ticket from granting more than a
 * single connection. The TTL keeps the in-memory map bounded.
 */

import { randomBytes } from 'node:crypto'

interface TicketEntry {
  userId: string
  expiresAt: number
}

const tickets = new Map<string, TicketEntry>()
const TTL_MS = 30_000

function sweepExpired(): void {
  const now = Date.now()
  for (const [token, entry] of tickets) {
    if (entry.expiresAt <= now) tickets.delete(token)
  }
}

/**
 * Mint a new ticket for this userId. Caller MUST have already authenticated
 * via the usual session middleware — this function is only called from
 * `POST /realtime/ticket`, which sits behind `requireAuth`.
 */
export function mintTicket(userId: string): {
  ticket: string
  expiresAt: number
} {
  sweepExpired()
  const token = randomBytes(32).toString('base64url')
  const expiresAt = Date.now() + TTL_MS
  tickets.set(token, { userId, expiresAt })
  return { ticket: token, expiresAt }
}

/**
 * Redeem a ticket for its userId. Removes it on use (one-time) and returns
 * null for unknown / expired / already-redeemed tickets. The caller
 * (WS upgrade handler) treats null as "401, reject upgrade".
 */
export function redeemTicket(token: string): string | null {
  sweepExpired()
  const entry = tickets.get(token)
  if (!entry) return null
  tickets.delete(token)
  if (entry.expiresAt <= Date.now()) return null
  return entry.userId
}

/**
 * Testing hook.
 */
export function _resetForTests(): void {
  tickets.clear()
}
