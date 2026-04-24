/**
 * Device wrap-secret service.
 *
 * Backs the `device_wrap_secrets` table. The secret is a 32-byte random
 * value that the client uses (via HKDF) to derive the AES key wrapping
 * its `localStorage`-persisted seed. See `SECURITY.md` →
 * "Recovery-key storage by platform" and `docs/crypto/key-hierarchy.md`
 * (`parchment-seed-wrap-v1`).
 */

import { randomBytes } from 'node:crypto'
import { and, eq, ne, sql } from 'drizzle-orm'
import { db } from '../db'
import {
  deviceWrapSecrets,
  type DeviceWrapSecret,
} from '../schema/device-wrap-secrets.schema'

function newSecretB64(): string {
  return randomBytes(32).toString('base64')
}

/**
 * Idempotently fetch (or create) a wrap secret for `(userId, deviceId)`.
 * Uses ON CONFLICT DO NOTHING + a follow-up select so a single racing
 * caller never clobbers another caller's freshly-inserted row.
 */
export async function getOrCreateDeviceWrapSecret(
  userId: string,
  deviceId: string,
): Promise<string> {
  const secret = newSecretB64()
  const inserted = await db
    .insert(deviceWrapSecrets)
    .values({ userId, deviceId, secret })
    .onConflictDoNothing()
    .returning()

  if (inserted.length > 0) return inserted[0].secret

  const rows: DeviceWrapSecret[] = await db
    .select()
    .from(deviceWrapSecrets)
    .where(
      and(
        eq(deviceWrapSecrets.userId, userId),
        eq(deviceWrapSecrets.deviceId, deviceId),
      ),
    )
  return rows[0].secret
}

/**
 * Rotate every device wrap secret owned by `userId`. Called after
 * "sign out of all devices" so any cached seed envelope on any device
 * fails AEAD on next open and forces re-unlock.
 *
 * When `excludeDeviceId` is supplied, that device's wrap secret is left
 * untouched. Used for "sign out OTHER devices" so the current device
 * can keep using its cached envelope without re-wrapping.
 *
 * We don't need a unique secret per row here — a single new secret would
 * still invalidate all cached envelopes — but rolling independently keeps
 * the per-device audit trail (rotatedAt) meaningful and matches what a
 * future per-device revoke would look like.
 */
export async function rotateAllForUser(
  userId: string,
  options?: { excludeDeviceId?: string },
): Promise<void> {
  const excludeDeviceId = options?.excludeDeviceId
  const whereUser = excludeDeviceId
    ? and(
        eq(deviceWrapSecrets.userId, userId),
        ne(deviceWrapSecrets.deviceId, excludeDeviceId),
      )
    : eq(deviceWrapSecrets.userId, userId)

  // Wrap in a transaction so either every device's wrap secret rolls
  // forward together, or none does. A half-rotated state would leave
  // some of the user's devices still wrapping the seed under the old
  // secret while "sign out all" or post-incident rotation promises
  // uniform revocation.
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ deviceId: deviceWrapSecrets.deviceId })
      .from(deviceWrapSecrets)
      .where(whereUser)

    for (const row of rows) {
      await tx
        .update(deviceWrapSecrets)
        .set({ secret: newSecretB64(), rotatedAt: sql`now()` })
        .where(
          and(
            eq(deviceWrapSecrets.userId, userId),
            eq(deviceWrapSecrets.deviceId, row.deviceId),
          ),
        )
    }
  })
}

/**
 * Drop a single device's wrap secret (e.g. an explicit per-device revoke).
 * Not currently wired to a UI — kept for symmetry with the rest of the
 * service.
 */
export async function deleteForDevice(
  userId: string,
  deviceId: string,
): Promise<void> {
  await db
    .delete(deviceWrapSecrets)
    .where(
      and(
        eq(deviceWrapSecrets.userId, userId),
        eq(deviceWrapSecrets.deviceId, deviceId),
      ),
    )
}
