/**
 * In-memory connection registry.
 *
 * Tracks open WebSocket connections keyed by userId. A single user can have
 * many connections at once (multiple tabs / devices) so each userId maps to
 * a `Map<connectionId, Connection>`. Adding twice with the same id is a
 * no-op; removing the last connection for a user drops the userId entry so
 * the map stays tight.
 *
 * We key by a string `connectionId` (not the raw socket object) because
 * Elysia wraps the underlying socket in a fresh `ElysiaWS` instance for
 * each handler call. Two different wrapper references can point at the
 * same physical connection, so identity-by-reference misses on close.
 *
 * This module is the ONLY place the connection state lives; subscribers
 * call `socketsForUser` to fan out. Keeping the storage isolated here makes
 * a future swap to a Redis-backed registry (for horizontal scale) a
 * single-file change.
 */

/**
 * Minimal shape we need for a live connection. `id` is our per-connection
 * primary key; `send` and `close` are the surface the subscribers use.
 * Decoupling from Elysia's `ElysiaWS` keeps the registry testable with a
 * plain object.
 */
export interface Connection {
  id: string
  send(data: string): unknown
  close?(code?: number, reason?: string): unknown
}

const userToConnections = new Map<string, Map<string, Connection>>()
const connectionIdToUser = new Map<string, string>()

/**
 * Register a new connection. Duplicate `id` replaces the previous entry —
 * callers should not reuse ids, but if they do we don't leak the old one.
 */
export function add(userId: string, connection: Connection): void {
  let bucket = userToConnections.get(userId)
  if (!bucket) {
    bucket = new Map()
    userToConnections.set(userId, bucket)
  }
  bucket.set(connection.id, connection)
  connectionIdToUser.set(connection.id, userId)
}

/**
 * Drop a connection by its id. Called on close / error / stale-send.
 */
export function removeById(connectionId: string): void {
  const userId = connectionIdToUser.get(connectionId)
  if (!userId) return
  connectionIdToUser.delete(connectionId)
  const bucket = userToConnections.get(userId)
  if (!bucket) return
  bucket.delete(connectionId)
  if (bucket.size === 0) {
    userToConnections.delete(userId)
  }
}

/**
 * Return the live connection list for a user, or an empty array when they
 * have no open connections. Returns a fresh array (snapshot of the Map's
 * values) so concurrent add/remove during iteration is safe.
 */
export function socketsForUser(userId: string): Connection[] {
  const bucket = userToConnections.get(userId)
  return bucket ? Array.from(bucket.values()) : []
}

/** Diagnostic counter. */
export function connectedUserCount(): number {
  return userToConnections.size
}

/** Diagnostic counter. */
export function totalSocketCount(): number {
  let total = 0
  for (const bucket of userToConnections.values()) total += bucket.size
  return total
}

/** Testing hook — wipe the registry. */
export function _resetForTests(): void {
  userToConnections.clear()
  connectionIdToUser.clear()
}
