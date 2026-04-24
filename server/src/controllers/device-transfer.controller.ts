import Elysia, { t } from 'elysia'
import { and, eq, gt, isNull, lte, sql } from 'drizzle-orm'
import { db } from '../db'
import { deviceTransferSessions } from '../schema/device-transfer.schema'
import { generateId } from '../util'
import { requireAuth } from '../middleware/auth.middleware'

/**
 * Device-to-device recovery transfer relay (Part C.8).
 *
 * The server's role is strictly plumbing: it stores an ephemeral E2EE-sealed
 * seed payload for up to 60s so the two devices can exchange it without
 * requiring peer-to-peer networking. It never sees plaintext and cannot
 * decrypt what it stores.
 *
 * Rate limits: 3 active sessions per user per hour (enforced in-app, see
 * createSession below).
 */

const app = new Elysia()

const SESSION_TTL_MS = 60_000
const RATE_LIMIT_WINDOW_MS = 60 * 60_000
const RATE_LIMIT_MAX_SESSIONS = 3

async function activeSessionCount(userId: string): Promise<number> {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS)
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(deviceTransferSessions)
    .where(
      and(
        eq(deviceTransferSessions.userId, userId),
        gt(deviceTransferSessions.createdAt, windowStart),
      ),
    )
  return Number(rows[0]?.count ?? 0)
}

/**
 * Receiver (new device): create a session advertising our ephemeral pubkey.
 * Returns a sessionId. Receiver then polls /device-transfer/:id for the
 * sealed payload.
 */
app.use(requireAuth).post(
  '/device-transfer',
  async ({ user, body, status }) => {
    const count = await activeSessionCount(user.id)
    if (count >= RATE_LIMIT_MAX_SESSIONS) {
      return status(429, {
        message: `Too many transfer sessions this hour (max ${RATE_LIMIT_MAX_SESSIONS})`,
      })
    }

    const id = generateId()
    const now = new Date()
    await db.insert(deviceTransferSessions).values({
      id,
      userId: user.id,
      receiverEphemeralPub: body.receiverEphemeralPub,
      consumed: false,
      createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    })
    return {
      sessionId: id,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    }
  },
  {
    body: t.Object({
      receiverEphemeralPub: t.String(),
    }),
    detail: {
      tags: ['DeviceTransfer'],
      description: 'Create a device-to-device transfer session (receiver side)',
    },
  },
)

/**
 * Sender (existing device): upload the sealed seed. Must be the same user.
 * This is the point where the sender's app should have already confirmed
 * the SAS match with the user and captured biometric consent.
 */
app.use(requireAuth).post(
  '/device-transfer/:id/upload',
  async ({ user, params, body, status }) => {
    // Atomic conditional update: only succeeds if the session exists, belongs
    // to this user, is still unconsumed, unexpired, and has no payload yet.
    // Race-safe — two concurrent sender uploads can't both "win" and overwrite
    // each other, because the second UPDATE matches zero rows once the first
    // has filled sealedSeed.
    const updated = await db
      .update(deviceTransferSessions)
      .set({
        senderEphemeralPub: body.senderEphemeralPub,
        sealedSeed: body.sealedSeed,
        senderSignature: body.senderSignature,
      })
      .where(
        and(
          eq(deviceTransferSessions.id, params.id),
          eq(deviceTransferSessions.userId, user.id),
          eq(deviceTransferSessions.consumed, false),
          gt(deviceTransferSessions.expiresAt, new Date()),
          isNull(deviceTransferSessions.sealedSeed),
        ),
      )
      .returning({ id: deviceTransferSessions.id })

    if (updated.length > 0) return { success: true }

    // Update matched zero rows — classify why so the client gets a useful
    // error code. This read is best-effort and only runs on the failure path.
    const row = await db
      .select()
      .from(deviceTransferSessions)
      .where(eq(deviceTransferSessions.id, params.id))
      .limit(1)
    if (!row[0]) return status(404, { message: 'Session not found' })
    if (row[0].userId !== user.id) {
      return status(403, { message: 'Session belongs to another user' })
    }
    if (row[0].consumed) {
      return status(410, { message: 'Session already consumed' })
    }
    if (row[0].expiresAt.getTime() < Date.now()) {
      return status(410, { message: 'Session expired' })
    }
    // sealedSeed already populated — either a double-submit from this sender
    // or a race another sender won.
    return status(409, { message: 'Payload already uploaded' })
  },
  {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      senderEphemeralPub: t.String(),
      sealedSeed: t.String(),
      senderSignature: t.String(),
    }),
    detail: {
      tags: ['DeviceTransfer'],
      description: 'Upload sealed seed payload (sender side)',
    },
  },
)

/**
 * Receiver: fetch the sealed payload. One-shot — marks session consumed.
 */
app.use(requireAuth).get(
  '/device-transfer/:id',
  async ({ user, params, status }) => {
    const row = await db
      .select()
      .from(deviceTransferSessions)
      .where(eq(deviceTransferSessions.id, params.id))
      .limit(1)
    if (!row[0]) return status(404, { message: 'Session not found' })
    if (row[0].userId !== user.id) {
      return status(403, { message: 'Session belongs to another user' })
    }
    if (row[0].consumed) {
      return status(410, { message: 'Session already consumed' })
    }
    if (row[0].expiresAt.getTime() < Date.now()) {
      return status(410, { message: 'Session expired' })
    }
    if (!row[0].sealedSeed) {
      // Not yet uploaded — receiver should poll.
      return status(425, { message: 'Payload not yet uploaded' })
    }

    // Atomically mark consumed. If someone else grabbed it first, bail.
    const consumedResult = await db
      .update(deviceTransferSessions)
      .set({ consumed: true })
      .where(
        and(
          eq(deviceTransferSessions.id, params.id),
          eq(deviceTransferSessions.consumed, false),
        ),
      )
      .returning()
    if (consumedResult.length === 0) {
      return status(410, { message: 'Session already consumed' })
    }

    return {
      sessionId: row[0].id,
      receiverEphemeralPub: row[0].receiverEphemeralPub,
      senderEphemeralPub: row[0].senderEphemeralPub,
      sealedSeed: row[0].sealedSeed,
      senderSignature: row[0].senderSignature,
    }
  },
  {
    params: t.Object({ id: t.String() }),
    detail: {
      tags: ['DeviceTransfer'],
      description: 'Fetch sealed payload (one-shot, receiver side)',
    },
  },
)

/**
 * Cancel a session early. Either side can call.
 */
app.use(requireAuth).delete(
  '/device-transfer/:id',
  async ({ user, params }) => {
    await db
      .delete(deviceTransferSessions)
      .where(
        and(
          eq(deviceTransferSessions.id, params.id),
          eq(deviceTransferSessions.userId, user.id),
        ),
      )
    return { success: true }
  },
  {
    params: t.Object({ id: t.String() }),
    detail: {
      tags: ['DeviceTransfer'],
      description: 'Cancel a device-transfer session',
    },
  },
)

/**
 * Periodic sweep of expired sessions. Not automatically scheduled; ops
 * can run via a cron or a Bun worker. Kept as an endpoint so a background
 * loop can poke it without depending on runtime state.
 */
app.post('/device-transfer/sweep', async () => {
  await db
    .delete(deviceTransferSessions)
    .where(lte(deviceTransferSessions.expiresAt, new Date()))
  return { success: true }
})

export default app
