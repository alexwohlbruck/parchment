/**
 * K_m (master-key) rotation primitives (Part C.7).
 *
 * This service provides the COORDINATION layer for a user-wide master-key
 * rotation. The actual re-encryption work happens client-side — the server
 * never sees cleartext user data. The server's role is:
 *
 *   1. Track the current `users.kmVersion` so every write records which
 *      key version it used.
 *   2. Provide an atomic "advance kmVersion" operation invoked by the
 *      client after it has finished re-encrypting all its data AND
 *      re-sealed K_m into every passkey-PRF slot.
 *
 * The full rotation flow lives client-side (not implemented in this PR —
 * see SECURITY.md §rotation for the planned sequence). Triggers:
 *
 *   - User removes a passkey (invalidate all slots that might have been
 *     seen on a lost device).
 *   - User-requested "rotate keys" in settings.
 *   - Compromise-response playbook.
 */

import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../schema/users.schema'

export async function getUserKmVersion(userId: string): Promise<number | null> {
  const row = await db
    .select({ kmVersion: users.kmVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!row[0]) return null
  return row[0].kmVersion
}

/**
 * Advance a user's kmVersion IFF it matches the caller's expected current
 * version. Returns the new version on success, null on contention.
 *
 * Callers (the client rotation orchestrator) pass `expectedCurrent`
 * so we fail-fast if another device rotated in parallel.
 */
export async function advanceKmVersion(params: {
  userId: string
  expectedCurrent: number
}): Promise<number | null> {
  const row = await db
    .select({ kmVersion: users.kmVersion })
    .from(users)
    .where(eq(users.id, params.userId))
    .limit(1)
  if (!row[0]) return null
  if (row[0].kmVersion !== params.expectedCurrent) return null

  const next = params.expectedCurrent + 1
  await db
    .update(users)
    .set({ kmVersion: next, updatedAt: new Date() })
    .where(eq(users.id, params.userId))
  return next
}
