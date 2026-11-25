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
 *   3. Refuse a commit that leaves any seed-derived ciphertext behind,
 *      so a record type the client forgot can never be stranded under
 *      the discarded seed.
 *
 * Triggers (all client-side):
 *   - User removes a passkey (invalidate slots that might have been
 *     seen on a lost device).
 *   - User-requested "rotate keys" in Settings.
 *   - Compromise-response playbook.
 */

import { and, eq, inArray, isNotNull, notInArray, or } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../schema/users.schema'
import { encryptedUserBlobs } from '../schema/personal-blobs.schema'
import { collections, encryptedPoints } from '../schema/library.schema'
import { routes } from '../schema/routes.schema'
import { canvases } from '../schema/canvases.schema'
import { shares, incomingShares } from '../schema/shares.schema'
import { wrappedMasterKeys } from '../schema/wrapped-master-keys.schema'
import { userFriendPins } from '../schema/federation.schema'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const LIVE_SHARE_STATUSES = ['pending', 'accepted']

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
  metadataEncrypted?: string
  /** A private collection's points, re-sealed under the new seed's key. */
  points?: Array<{ id: string; encryptedData: string }>
}

export interface RotationRecord {
  id: string
  metadataEncrypted?: string
  bodyEncrypted?: string
}

export interface RotationEnvelope {
  id: string
  encryptedData: string
  nonce: string
}

export interface RotationFriendPin {
  friendHandle: string
  encryptedPin: string
  nonce: string
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
  routes?: RotationRecord[]
  canvases?: RotationRecord[]
  /** Outgoing share envelopes, re-sealed with the new encryption key. */
  shares?: RotationEnvelope[]
  /** Envelopes shared with this user, re-sealed with the new encryption key. */
  incomingShares?: RotationEnvelope[]
  friendPins?: RotationFriendPin[]
  slots?: RotationSlot[]
  /** The user saw and confirmed the new recovery key. */
  recoveryKeyConfirmed?: boolean
}

export class RotationConflict extends Error {
  constructor() {
    super(
      'kmVersion mismatch — another device rotated first. Nothing was written.',
    )
    this.name = 'RotationConflict'
  }
}

/** The commit would leave data sealed under the old seed. Nothing was written. */
export class RotationIncomplete extends Error {
  constructor(readonly missing: string[]) {
    super(
      `Rotation is missing re-encrypted data: ${missing.join(', ')}. Nothing was written.`,
    )
    this.name = 'RotationIncomplete'
  }
}

/** Rotation can't keep these shares readable, so it refuses instead of breaking them. */
export class RotationBlocked extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RotationBlocked'
  }
}

/**
 * Apply a rotation's post-state atomically:
 *
 *   1. Advance kmVersion with a conditional UPDATE; zero rows means
 *      another device won (`RotationConflict`).
 *   2. Check the commit re-encrypts every seed-derived record the user
 *      has (`RotationIncomplete`), and that no share would become
 *      unreadable (`RotationBlocked`).
 *   3. Write blobs, collections and points, routes, canvases, share
 *      envelopes and slots; drop slots that weren't re-sealed, since
 *      they still unwrap the discarded seed.
 *
 * Everything runs inside `db.transaction`, so any throw rolls back the
 * whole thing. Returns the new kmVersion on success.
 */
export async function commitRotation(
  params: CommitRotationParams,
): Promise<number> {
  if (!params.slots?.length && !params.recoveryKeyConfirmed) {
    throw new RotationBlocked(
      'Re-seal at least one passkey or confirm the new recovery key, or nothing could unlock the new keys.',
    )
  }

  return await db.transaction(async (tx) => {
    const nextKmVersion = params.expectedCurrent + 1
    const [advanced] = await tx
      .update(users)
      .set({
        signingKey: params.signingKey,
        encryptionKey: params.encryptionKey,
        kmVersion: nextKmVersion,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(users.id, params.userId),
          eq(users.kmVersion, params.expectedCurrent),
        ),
      )
      .returning({ id: users.id })
    if (!advanced) {
      const [exists] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, params.userId))
        .limit(1)
      if (!exists) throw new Error('User not found')
      throw new RotationConflict()
    }

    await assertRotationCovers(tx, params)

    const now = new Date()
    for (const blob of params.blobs ?? []) {
      await tx
        .insert(encryptedUserBlobs)
        .values({
          userId: params.userId,
          blobType: blob.blobType,
          encryptedBlob: blob.encryptedBlob,
          nonce: '',
          kmVersion: nextKmVersion,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [encryptedUserBlobs.userId, encryptedUserBlobs.blobType],
          set: {
            encryptedBlob: blob.encryptedBlob,
            nonce: '',
            kmVersion: nextKmVersion,
            updatedAt: now,
          },
        })
    }

    for (const c of params.collections ?? []) {
      if (c.metadataEncrypted !== undefined) {
        await tx
          .update(collections)
          .set({ metadataEncrypted: c.metadataEncrypted, updatedAt: now })
          .where(
            and(eq(collections.id, c.id), eq(collections.userId, params.userId)),
          )
      }
      for (const point of c.points ?? []) {
        await tx
          .update(encryptedPoints)
          .set({ encryptedData: point.encryptedData, updatedAt: now })
          .where(
            and(
              eq(encryptedPoints.id, point.id),
              eq(encryptedPoints.collectionId, c.id),
            ),
          )
      }
    }

    for (const r of params.routes ?? []) {
      await tx
        .update(routes)
        .set({
          ...(r.metadataEncrypted !== undefined && {
            metadataEncrypted: r.metadataEncrypted,
          }),
          ...(r.bodyEncrypted !== undefined && { bodyEncrypted: r.bodyEncrypted }),
          updatedAt: now,
        })
        .where(and(eq(routes.id, r.id), eq(routes.userId, params.userId)))
    }

    for (const c of params.canvases ?? []) {
      await tx
        .update(canvases)
        .set({
          ...(c.metadataEncrypted !== undefined && {
            metadataEncrypted: c.metadataEncrypted,
          }),
          ...(c.bodyEncrypted !== undefined && { bodyEncrypted: c.bodyEncrypted }),
          updatedAt: now,
        })
        .where(and(eq(canvases.id, c.id), eq(canvases.userId, params.userId)))
    }

    await writeShareEnvelopes(tx, params)

    for (const pin of params.friendPins ?? []) {
      await tx
        .update(userFriendPins)
        .set({ encryptedPin: pin.encryptedPin, nonce: pin.nonce, updatedAt: now })
        .where(
          and(
            eq(userFriendPins.userId, params.userId),
            eq(userFriendPins.friendHandle, pin.friendHandle),
          ),
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
          createdAt: now,
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
    const resealed = (params.slots ?? []).map((s) => s.credentialId)
    await tx
      .delete(wrappedMasterKeys)
      .where(
        and(
          eq(wrappedMasterKeys.userId, params.userId),
          ...(resealed.length
            ? [notInArray(wrappedMasterKeys.credentialId, resealed)]
            : []),
        ),
      )

    return nextKmVersion
  })
}

/**
 * Every record sealed under the user's seed, or with their static
 * encryption key, must arrive re-encrypted. Add a table here whenever a
 * new seed-derived ciphertext type is introduced.
 */
async function assertRotationCovers(
  tx: Tx,
  params: CommitRotationParams,
): Promise<void> {
  const missing: string[] = []
  const has = <T extends { id: string }>(list: T[] | undefined) =>
    new Map((list ?? []).map((item) => [item.id, item]))

  const sentBlobs = new Set((params.blobs ?? []).map((b) => b.blobType))
  const blobs = await tx
    .select({ blobType: encryptedUserBlobs.blobType })
    .from(encryptedUserBlobs)
    .where(eq(encryptedUserBlobs.userId, params.userId))
  for (const b of blobs) {
    if (!sentBlobs.has(b.blobType)) missing.push(`blob ${b.blobType}`)
  }

  const sentCollections = has(params.collections)
  const owned = await tx
    .select({
      id: collections.id,
      scheme: collections.scheme,
      metadataEncrypted: collections.metadataEncrypted,
    })
    .from(collections)
    .where(eq(collections.userId, params.userId))
  const privateIds = owned
    .filter((c) => c.scheme === 'user-e2ee')
    .map((c) => c.id)
  for (const c of owned) {
    if (c.metadataEncrypted && sentCollections.get(c.id)?.metadataEncrypted === undefined) {
      missing.push(`collection ${c.id}`)
    }
  }
  if (privateIds.length) {
    const points = await tx
      .select({ id: encryptedPoints.id, collectionId: encryptedPoints.collectionId })
      .from(encryptedPoints)
      .where(inArray(encryptedPoints.collectionId, privateIds))
    for (const p of points) {
      const sent = sentCollections.get(p.collectionId)?.points ?? []
      if (!sent.some((s) => s.id === p.id)) missing.push(`point ${p.id}`)
    }
  }

  for (const [label, table, sent] of [
    ['route', routes, has(params.routes)],
    ['canvas', canvases, has(params.canvases)],
  ] as const) {
    const rows = await tx
      .select({
        id: table.id,
        metadataEncrypted: table.metadataEncrypted,
        bodyEncrypted: table.bodyEncrypted,
      })
      .from(table)
      .where(
        and(
          eq(table.userId, params.userId),
          or(isNotNull(table.metadataEncrypted), isNotNull(table.bodyEncrypted)),
        ),
      )
    for (const row of rows) {
      const record = sent.get(row.id)
      if (
        (row.metadataEncrypted && record?.metadataEncrypted === undefined) ||
        (row.bodyEncrypted && record?.bodyEncrypted === undefined)
      ) {
        missing.push(`${label} ${row.id}`)
      }
    }
  }

  if (privateIds.length) {
    const sentShares = has(params.shares)
    const outgoing = await tx
      .select({
        id: shares.id,
        recipientUserId: shares.recipientUserId,
        recipientHandle: shares.recipientHandle,
      })
      .from(shares)
      .where(
        and(
          eq(shares.userId, params.userId),
          eq(shares.resourceType, 'collection'),
          inArray(shares.resourceId, privateIds),
          inArray(shares.status, LIVE_SHARE_STATUSES),
        ),
      )
    const remote = outgoing.filter((s) => !s.recipientUserId)
    if (remote.length) {
      throw new RotationBlocked(
        `Stop sharing your private collections with ${remote
          .map((s) => s.recipientHandle)
          .join(', ')} first. They're on another server, so new keys can't reach them.`,
      )
    }
    for (const s of outgoing) {
      if (!sentShares.has(s.id)) missing.push(`share ${s.id}`)
    }
  }

  const sentIncoming = has(params.incomingShares)
  const incoming = await tx
    .select({ id: incomingShares.id })
    .from(incomingShares)
    .innerJoin(collections, eq(collections.id, incomingShares.resourceId))
    .where(
      and(
        eq(incomingShares.userId, params.userId),
        eq(incomingShares.resourceType, 'collection'),
        eq(collections.scheme, 'user-e2ee'),
        inArray(incomingShares.status, LIVE_SHARE_STATUSES),
      ),
    )
  for (const s of incoming) {
    if (!sentIncoming.has(s.id)) missing.push(`incoming share ${s.id}`)
  }

  const sentPins = new Set((params.friendPins ?? []).map((p) => p.friendHandle))
  const pins = await tx
    .select({ friendHandle: userFriendPins.friendHandle })
    .from(userFriendPins)
    .where(eq(userFriendPins.userId, params.userId))
  for (const p of pins) {
    if (!sentPins.has(p.friendHandle)) missing.push(`friend pin ${p.friendHandle}`)
  }

  if (missing.length) throw new RotationIncomplete(missing)
}

/**
 * A static-DH envelope opens with either party's private key, so both the
 * owner's outgoing row and the recipient's mirror carry the same bytes.
 */
async function writeShareEnvelopes(
  tx: Tx,
  params: CommitRotationParams,
): Promise<void> {
  for (const e of params.shares ?? []) {
    const [row] = await tx
      .update(shares)
      .set({ encryptedData: e.encryptedData, nonce: e.nonce })
      .where(and(eq(shares.id, e.id), eq(shares.userId, params.userId)))
      .returning({
        recipientUserId: shares.recipientUserId,
        resourceType: shares.resourceType,
        resourceId: shares.resourceId,
      })
    if (!row?.recipientUserId) continue
    await tx
      .update(incomingShares)
      .set({ encryptedData: e.encryptedData, nonce: e.nonce })
      .where(
        and(
          eq(incomingShares.userId, row.recipientUserId),
          eq(incomingShares.resourceType, row.resourceType),
          eq(incomingShares.resourceId, row.resourceId),
        ),
      )
  }

  for (const e of params.incomingShares ?? []) {
    const [row] = await tx
      .update(incomingShares)
      .set({ encryptedData: e.encryptedData, nonce: e.nonce })
      .where(
        and(
          eq(incomingShares.id, e.id),
          eq(incomingShares.userId, params.userId),
        ),
      )
      .returning({
        resourceType: incomingShares.resourceType,
        resourceId: incomingShares.resourceId,
      })
    if (!row) continue
    await tx
      .update(shares)
      .set({ encryptedData: e.encryptedData, nonce: e.nonce })
      .where(
        and(
          eq(shares.recipientUserId, params.userId),
          eq(shares.resourceType, row.resourceType),
          eq(shares.resourceId, row.resourceId),
        ),
      )
  }
}
