import Elysia, { t } from 'elysia'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { wrappedMasterKeys } from '../schema/wrapped-master-keys.schema'
import { requireAuth } from '../middleware/auth.middleware'

/**
 * Passkey-PRF wrapped master key slots.
 *
 * Server stores opaque rows. Clients verify `slotSignature` on read using
 * the user's long-term Ed25519 public key before trusting `wrappedKm`.
 */

const app = new Elysia()

app.use(requireAuth).get(
  '/me/wrapped-keys',
  async ({ user }) => {
    const rows = await db
      .select()
      .from(wrappedMasterKeys)
      .where(eq(wrappedMasterKeys.userId, user.id))
    return { slots: rows }
  },
  {
    detail: {
      tags: ['WrappedKeys'],
      description: 'List passkey-PRF slots for the current user',
    },
  },
)

app.use(requireAuth).post(
  '/me/wrapped-keys',
  async ({ user, body, set }) => {
    await db
      .insert(wrappedMasterKeys)
      .values({
        userId: user.id,
        credentialId: body.credentialId,
        wrappedKm: body.wrappedKm,
        wrapAlgo: body.wrapAlgo ?? 'aes-256-gcm-prf-v1',
        slotSignature: body.slotSignature,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [wrappedMasterKeys.userId, wrappedMasterKeys.credentialId],
        set: {
          wrappedKm: body.wrappedKm,
          wrapAlgo: body.wrapAlgo ?? 'aes-256-gcm-prf-v1',
          slotSignature: body.slotSignature,
        },
      })
    set.status = 201
    return { success: true }
  },
  {
    body: t.Object({
      credentialId: t.String(),
      wrappedKm: t.String(),
      slotSignature: t.String(),
      wrapAlgo: t.Optional(t.String()),
    }),
    detail: {
      tags: ['WrappedKeys'],
      description: 'Upsert a passkey-PRF slot for the current user',
    },
  },
)

app.use(requireAuth).delete(
  '/me/wrapped-keys/:credentialId',
  async ({ user, params }) => {
    await db
      .delete(wrappedMasterKeys)
      .where(
        and(
          eq(wrappedMasterKeys.userId, user.id),
          eq(wrappedMasterKeys.credentialId, params.credentialId),
        ),
      )
    return { success: true }
  },
  {
    params: t.Object({ credentialId: t.String() }),
    detail: {
      tags: ['WrappedKeys'],
      description: 'Delete a passkey-PRF slot',
    },
  },
)

app.use(requireAuth).post(
  '/me/wrapped-keys/:credentialId/used',
  async ({ user, params }) => {
    await db
      .update(wrappedMasterKeys)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(wrappedMasterKeys.userId, user.id),
          eq(wrappedMasterKeys.credentialId, params.credentialId),
        ),
      )
    return { success: true }
  },
  {
    params: t.Object({ credentialId: t.String() }),
    detail: {
      tags: ['WrappedKeys'],
      description: 'Mark a slot used (updates lastUsedAt)',
    },
  },
)

export default app
