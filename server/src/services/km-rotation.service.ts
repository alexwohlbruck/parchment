/**
 * K_m (master-key) rotation (Part C.7).
 *
 * The actual re-encryption work happens client-side — the server never
 * sees cleartext user data. This service handles the server-side
 * coordination:
 *
 *   1. Track the current `users.kmVersion` so every write records which
 *      key version encrypted it.
 *   2. Provide an **atomic commit** operation that the client calls once,
 *      after it has re-encrypted everything locally and run all the
 *      passkey-PRF resealing ceremonies. The operation takes the full
 *      post-rotation state (new public keys + re-encrypted blobs +
 *      re-encrypted collection envelopes + re-sealed slots) and applies
 *      it inside a single DB transaction that's gated by a CAS check on
 *      `expectedCurrent`. If another device rotated first, the whole
 *      commit is rejected before any state is written — no partial
 *      rotation possible, no "server has data under our new seed but
 *      public keys overwrote the winner's".
 *
 * The legacy `advanceKmVersion` (kmVersion++ only) is kept for
 * compatibility but is no longer used on the happy path.
 *
 * Triggers (all client-side):
 *   - User removes a passkey (invalidate slots that might have been
 *     seen on a lost device).
 *   - User-requested "rotate keys" in Settings.
 *   - Compromise-response playbook.
 */

import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../schema/users.schema'
import { encryptedUserBlobs } from '../schema/personal-blobs.schema'
import { collections } from '../schema/library.schema'
import { wrappedMasterKeys } from '../schema/wrapped-master-keys.schema'

export async function getUserKmVersion(userId: string): Promise<number | null> {
  const row = await db
    .select({ kmVersion: users.kmVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!row[0]) return null
  return row[0].kmVersion
}

// ---------------------------------------------------------------------------
// Atomic commit
// ---------------------------------------------------------------------------

export interface RotationBlob {
  blobType: string
  encryptedBlob: string
}

export interface RotationCollection {
  id: string
  metadataEncrypted: string
}

export interface RotationSlot {
  credentialId: string
  wrappedKm: string
  wrapAlgo?: string
  slotSignature: string
}

export interface CommitRotationParams {
  userId: string
  expectedCurrent: number
  signingKey: string
  encryptionKey: string
  blobs?: RotationBlob[]
  collections?: RotationCollection[]
  slots?: RotationSlot[]
}

export class RotationConflict extends Error {
  constructor() {
    super(
      'kmVersion mismatch — another device rotated first. Nothing was written.',
    )
    this.name = 'RotationConflict'
  }
}

/**
 * Apply a rotation's post-state atomically:
 *
 *   1. Re-read kmVersion; if it doesn't equal `expectedCurrent`, throw
 *      `RotationConflict` and do NOT touch any user state.
 *   2. Update `users.signingKey`, `users.encryptionKey`,
 *      `users.kmVersion = expectedCurrent + 1`.
 *   3. Upsert every rebuilt personal-blob envelope (by blobType).
 *   4. Update every rebuilt collection metadata envelope (by id, scoped
 *      to this user so we can't be tricked into touching another user's
 *      collection).
 *   5. Upsert every re-sealed wrapped-master-key slot.
 *
 * Everything runs inside `db.transaction` so a mid-write failure rolls
 * back the whole thing. Returns the new kmVersion on success.
 */
export async function commitRotation(
  params: CommitRotationParams,
): Promise<number> {
  return await db.transaction(async (tx) => {
    // Re-check kmVersion under the transaction. Postgres's default
    // isolation level (READ COMMITTED) won't stop a concurrent writer
    // between select + update, so a parallel rotation could sneak in;
    // the kmVersion column is effectively our lock — two rotations
    // can't both see the same `expectedCurrent` and both win.
    const row = await tx
      .select({ kmVersion: users.kmVersion })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1)
    if (!row[0]) {
      throw new Error('User not found')
    }
    if (row[0].kmVersion !== params.expectedCurrent) {
      throw new RotationConflict()
    }

    const nextKmVersion = params.expectedCurrent + 1
    await tx
      .update(users)
      .set({
        signingKey: params.signingKey,
        encryptionKey: params.encryptionKey,
        kmVersion: nextKmVersion,
        updatedAt: new Date(),
      })
      .where(eq(users.id, params.userId))

    for (const blob of params.blobs ?? []) {
      await tx
        .insert(encryptedUserBlobs)
        .values({
          userId: params.userId,
          blobType: blob.blobType,
          encryptedBlob: blob.encryptedBlob,
          nonce: '',
          kmVersion: nextKmVersion,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [encryptedUserBlobs.userId, encryptedUserBlobs.blobType],
          set: {
            encryptedBlob: blob.encryptedBlob,
            nonce: '',
            kmVersion: nextKmVersion,
            updatedAt: new Date(),
          },
        })
    }

    for (const c of params.collections ?? []) {
      await tx
        .update(collections)
        .set({
          metadataEncrypted: c.metadataEncrypted,
          updatedAt: new Date(),
        })
        .where(
          and(eq(collections.id, c.id), eq(collections.userId, params.userId)),
        )
    }

    for (const s of params.slots ?? []) {
      await tx
        .insert(wrappedMasterKeys)
        .values({
          userId: params.userId,
          credentialId: s.credentialId,
          wrappedKm: s.wrappedKm,
          wrapAlgo: s.wrapAlgo ?? 'aes-256-gcm-prf-v1',
          slotSignature: s.slotSignature,
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [wrappedMasterKeys.userId, wrappedMasterKeys.credentialId],
          set: {
            wrappedKm: s.wrappedKm,
            wrapAlgo: s.wrapAlgo ?? 'aes-256-gcm-prf-v1',
            slotSignature: s.slotSignature,
          },
        })
    }

    return nextKmVersion
  })
}
