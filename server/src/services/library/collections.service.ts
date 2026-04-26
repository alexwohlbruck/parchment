import { db } from '../../db'
import {
  collections,
  bookmarksCollections,
  encryptedPoints,
} from '../../schema/library.schema'
import { shares, incomingShares, ShareRole } from '../../schema/shares.schema'
import { users } from '../../schema/users.schema'
import { and, eq, count, sql, or } from 'drizzle-orm'
import { parseHandle } from '../../lib/crypto'
import { buildHandle, isLocalHandle } from '../federation.service'
import { emit } from '../realtime/emit'
import { resolveCollectionRecipients } from '../realtime/recipients.service'
import {
  CreateCollectionParams,
  NewCollection,
  NewBookmarkCollection,
  Collection,
} from '../../types/library.types'
import { generateId } from '../../util'
import { getBookmarkById } from './bookmarks.service'
import { bookmarks as bookmarksSchema } from '../../schema/library.schema'
import { inArray } from 'drizzle-orm'
import { unbookmark } from './bookmarks.service'
import { createSelectFieldsWithGeometry } from '../../util/geometry-conversion'
import { randomBytes } from 'node:crypto'

// Automatically generate bookmark select fields - no manual field listing needed!
const bookmarkSelectFields = createSelectFieldsWithGeometry(bookmarksSchema)

/**
 * Look up a same-server recipient's user_id from their federated handle.
 * Returns null for cross-server handles (we can't touch remote incoming
 * rows) or for handles that don't map to a user on this server.
 */
async function resolveLocalRecipientUserId(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  handle: string,
): Promise<string | null> {
  if (!isLocalHandle(handle)) return null
  const parsed = parseHandle(handle)
  if (!parsed) return null
  const [u] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.alias, parsed.alias))
    .limit(1)
  return u?.id ?? null
}

/**
 * The owner's federated handle, derived from their user_id. Used as the
 * `senderHandle` on every incoming_shares row their recipients see.
 */
async function getOwnerHandle(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
): Promise<string | null> {
  const [u] = await tx
    .select({ alias: users.alias })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!u?.alias) return null
  return buildHandle(u.alias)
}

export async function getCollections(userId: string) {
  return await db
    .select()
    .from(collections)
    .where(eq(collections.userId, userId))
}

export async function getCollectionById(id: string, userId: string) {
  return (
    await db
      .select()
      .from(collections)
      .where(and(eq(collections.id, id), eq(collections.userId, userId)))
  )[0]
}

/**
 * Fields the recipient needs to decrypt a shared collection's metadata.
 * For shared rows, the owner encrypted the display metadata (name, icon,
 * etc.) into the ECIES friend-share envelope alongside the collection
 * identifier. The client uses `senderHandle` to look up the sender's
 * long-term X25519 pubkey (from its friends store) and then decrypts
 * `{encryptedData, nonce}`.
 *
 * Absent on owner rows — owners already have their own K_m to decrypt
 * the authoritative `metadataEncrypted` envelope.
 */
export interface ShareEnvelopeAttachment {
  shareEnvelope: {
    encryptedData: string
    nonce: string
  }
  senderHandle: string
}

/**
 * Fetch a collection the caller can see — either owns it OR has an active
 * incoming_shares row on it. When returned as a share, the caller's role
 * and the share envelope (needed to decrypt metadata) are attached.
 * Returns null if the caller has no access at all (do not leak existence).
 */
export async function getAccessibleCollection(
  id: string,
  userId: string,
): Promise<
  | (Collection & { role: 'owner' | ShareRole } & Partial<ShareEnvelopeAttachment>)
  | null
> {
  const [collection] = await db
    .select()
    .from(collections)
    .where(eq(collections.id, id))
    .limit(1)
  if (!collection) return null

  if (collection.userId === userId) {
    return { ...collection, role: 'owner' }
  }

  const [share] = await db
    .select({
      role: incomingShares.role,
      encryptedData: incomingShares.encryptedData,
      nonce: incomingShares.nonce,
      senderHandle: incomingShares.senderHandle,
    })
    .from(incomingShares)
    .where(
      and(
        eq(incomingShares.userId, userId),
        eq(incomingShares.resourceType, 'collection'),
        eq(incomingShares.resourceId, id),
        or(
          eq(incomingShares.status, 'accepted'),
          eq(incomingShares.status, 'pending'),
        ),
      ),
    )
    .limit(1)
  if (!share) return null

  return {
    ...collection,
    role: share.role,
    shareEnvelope: { encryptedData: share.encryptedData, nonce: share.nonce },
    senderHandle: share.senderHandle,
  }
}

/**
 * List every collection shared TO `userId` (via `incoming_shares`), joined
 * with the underlying collection row, the recipient's role, and the share
 * envelope needed to decrypt shared metadata. Owners' own collections are
 * NOT included — callers merge this with `getCollections` to assemble a
 * full library view.
 */
export async function getSharedCollections(
  userId: string,
): Promise<Array<Collection & { role: ShareRole } & ShareEnvelopeAttachment>> {
  const rows = await db
    .select({
      collection: collections,
      role: incomingShares.role,
      encryptedData: incomingShares.encryptedData,
      nonce: incomingShares.nonce,
      senderHandle: incomingShares.senderHandle,
    })
    .from(incomingShares)
    .innerJoin(collections, eq(collections.id, incomingShares.resourceId))
    .where(
      and(
        eq(incomingShares.userId, userId),
        eq(incomingShares.resourceType, 'collection'),
        or(
          eq(incomingShares.status, 'accepted'),
          eq(incomingShares.status, 'pending'),
        ),
      ),
    )

  return rows.map((r) => ({
    ...r.collection,
    role: r.role,
    shareEnvelope: { encryptedData: r.encryptedData, nonce: r.nonce },
    senderHandle: r.senderHandle,
  }))
}

/**
 * Create a single starter collection for a freshly-registered user. Called
 * from the user-creation hook. No metadata envelope is written here — the
 * server never sees the E2EE key. The client fills in an initial name/icon
 * the first time it loads the user's library and encounters an owner
 * collection without metadata.
 */
export async function createInitialCollection(userId: string) {
  const [inserted] = await db
    .insert(collections)
    .values({
      id: generateId(),
      isPublic: false,
      userId,
    })
    .returning()
  return inserted
}

export async function createCollection(params: CreateCollectionParams) {
  const newCollection: NewCollection = {
    id: generateId(),
    metadataEncrypted: params.metadataEncrypted,
    metadataKeyVersion: params.metadataKeyVersion ?? 1,
    isPublic: params.isPublic || false,
    userId: params.userId,
  }

  const [inserted] = await db
    .insert(collections)
    .values(newCollection)
    .returning()
  // Owner-only at creation; no share rows exist yet. The resolver still
  // looks them up but returns only the owner — keeps the emit site
  // uniform with `updateCollection` etc.
  await emit.collection('collection:created', inserted, inserted.id)
  return inserted
}

export async function updateCollection(
  id: string,
  userId: string,
  updates: Partial<Collection>,
) {
  const { userId: _, id: __, ...validUpdates } = updates

  const [updatedCollection] = await db
    .update(collections)
    .set({
      ...validUpdates,
      updatedAt: new Date(),
    })
    .where(and(eq(collections.id, id), eq(collections.userId, userId)))
    .returning()

  if (updatedCollection) {
    await emit.collection(
      'collection:updated',
      updatedCollection,
      updatedCollection.id,
    )
  }

  return updatedCollection
}

export async function deleteCollection(id: string, userId: string) {
  // Resolve recipients BEFORE the delete — once the share rows are gone
  // we can't reconstruct who had access. Emit AFTER the commit so we
  // don't notify on a rolled-back delete.
  const recipientsBefore = await resolveCollectionRecipients(id)

  const deleted = await db.transaction(async (tx) => {
    await tx
      .delete(bookmarksCollections)
      .where(eq(bookmarksCollections.collectionId, id))

    const [row] = await tx
      .delete(collections)
      .where(and(eq(collections.id, id), eq(collections.userId, userId)))
      .returning()

    if (!row) return undefined

    // Drop every dangling share row. The outgoing `shares` rows were
    // created by this owner; the mirrored `incoming_shares` rows live
    // on recipients' user_ids and match by resource_id. Both are purely
    // bookkeeping — the collection they refer to is gone.
    await tx
      .delete(shares)
      .where(
        and(
          eq(shares.userId, userId),
          eq(shares.resourceType, 'collection'),
          eq(shares.resourceId, id),
        ),
      )
    await tx
      .delete(incomingShares)
      .where(
        and(
          eq(incomingShares.resourceType, 'collection'),
          eq(incomingShares.resourceId, id),
        ),
      )

    return row
  })

  if (deleted) {
    // Use the pre-resolved recipient set directly rather than going
    // through the emit helper (whose resolver would return empty now).
    const { publish } = await import('../realtime/event-bus.service')
    publish('collection:deleted', { id }, recipientsBefore)
  }

  return deleted
}

// ===== Bookmarks in Collections =====

export async function getBookmarksInCollection(
  collectionId: string,
  userId: string,
) {
  // The caller's access to this collection is authorized upstream (the
  // controller uses `getAccessibleCollection` for shared reads and
  // `getCollectionById` for owner-only paths). We just need to confirm
  // the collection exists — if it doesn't, fall through with an empty
  // result so we don't leak existence.
  const collection = await getCollectionById(collectionId, userId)
  if (!collection) {
    return []
  }

  const bookmarkLinks = await db
    .select({ bookmarkId: bookmarksCollections.bookmarkId })
    .from(bookmarksCollections)
    .where(eq(bookmarksCollections.collectionId, collectionId))

  if (bookmarkLinks.length === 0) {
    return []
  }

  const bookmarkIds = bookmarkLinks.map((link) => link.bookmarkId)

  // No per-user filter here: access control lives at the collection
  // boundary, and bookmark rows added by editors on shared collections
  // carry the editor's user_id. Filtering by userId would hide those
  // rows from the owner's view. The pivot table already scopes the
  // query to this collection's bookmarks only.
  const bookmarks = await db
    .select(bookmarkSelectFields)
    .from(bookmarksSchema)
    .where(inArray(bookmarksSchema.id, bookmarkIds))

  return bookmarks
}

// ===== Collection key rotation (revoke-on-e2ee) =====

/**
 * Payload the owner's client sends after building the new rotation locally.
 *
 * `metadataKeyVersion` is the NEW version (typically old + 1). Every
 * ciphertext (collection metadata + all encrypted points + every remaining
 * friend-share envelope) is already encrypted under the new key by the
 * owner's device. The server's only job is to atomically swap them in.
 *
 * `revokeRecipientHandles` are the handles whose shares must be deleted in
 * the same transaction — that's the actual "revoke" operation. Anyone not
 * listed gets their `shares.encryptedData` updated to the new rewrapped
 * value from `updatedShareEnvelopes`.
 */
export interface RotateCollectionKeyParams {
  collectionId: string
  userId: string
  newMetadataEncrypted: string
  newMetadataKeyVersion: number
  newEncryptedPoints: Array<{
    id?: string // reuse existing id when possible; mint a fresh one when null
    encryptedData: string
    nonce: string
  }>
  updatedShareEnvelopes: Array<{
    recipientHandle: string
    encryptedData: string
    nonce: string
  }>
  revokeRecipientHandles: string[]
}

/**
 * Thrown when the caller's metadataKeyVersion doesn't move forward (would
 * cause rotation to silently no-op). Controllers map this to 400.
 */
export class RotationVersionError extends Error {
  constructor(current: number, proposed: number) {
    super(
      `New metadataKeyVersion ${proposed} must be greater than current ${current}`,
    )
    this.name = 'RotationVersionError'
  }
}

/**
 * Apply a complete collection-key rotation in a single transaction.
 *
 * Every write (metadata, points, share envelopes, revoked shares) is staged
 * by the client under the NEW key before calling this endpoint. The server
 * never sees plaintext and doesn't need to understand key derivation — it
 * just swaps ciphertext rows atomically so no caller ever observes a
 * half-rotated collection.
 *
 * Owner-only. No-op + null if the collection doesn't exist or isn't owned
 * by `userId`.
 */
export async function rotateCollectionKey(
  params: RotateCollectionKeyParams,
): Promise<Collection | null> {
  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(collections)
      .where(
        and(
          eq(collections.id, params.collectionId),
          eq(collections.userId, params.userId),
        ),
      )
      .limit(1)
    if (!current) return null

    if (params.newMetadataKeyVersion <= current.metadataKeyVersion) {
      throw new RotationVersionError(
        current.metadataKeyVersion,
        params.newMetadataKeyVersion,
      )
    }

    // 1. Swap the collection metadata envelope + version. Also clears any
    //    public-link token — public links are only valid on server-key
    //    collections, and a rotation usually accompanies a scheme or
    //    membership change where the old token's trust context no longer
    //    applies.
    const [updatedCollection] = await tx
      .update(collections)
      .set({
        metadataEncrypted: params.newMetadataEncrypted,
        metadataKeyVersion: params.newMetadataKeyVersion,
        publicToken: null,
        publicRole: null,
        updatedAt: new Date(),
      })
      .where(eq(collections.id, params.collectionId))
      .returning()

    // 2. Re-seed the encrypted_points table with the new ciphertexts.
    //    Simplest correct sequence: delete all, reinsert. The client
    //    supplies new ids (or we mint).
    await tx
      .delete(encryptedPoints)
      .where(eq(encryptedPoints.collectionId, params.collectionId))

    if (params.newEncryptedPoints.length > 0) {
      await tx.insert(encryptedPoints).values(
        params.newEncryptedPoints.map((p) => ({
          id: p.id ?? generateId(),
          collectionId: params.collectionId,
          userId: params.userId,
          encryptedData: p.encryptedData,
          nonce: p.nonce,
        })),
      )
    }

    const ownerHandle = await getOwnerHandle(tx, params.userId)

    // 3. Update each remaining share's outbound envelope (rewrapped key).
    for (const env of params.updatedShareEnvelopes) {
      await tx
        .update(shares)
        .set({
          encryptedData: env.encryptedData,
          nonce: env.nonce,
        })
        .where(
          and(
            eq(shares.userId, params.userId),
            eq(shares.resourceType, 'collection'),
            eq(shares.resourceId, params.collectionId),
            eq(shares.recipientHandle, env.recipientHandle),
          ),
        )

      // Mirror on the SAME-SERVER recipient's incoming_shares row. The row
      // is keyed by the recipient's user_id + the owner's handle in
      // sender_handle, so narrow to both. Cross-server recipients live on
      // their peer's DB and are untouched here.
      if (ownerHandle) {
        const recipientUserId = await resolveLocalRecipientUserId(
          tx,
          env.recipientHandle,
        )
        if (recipientUserId) {
          await tx
            .update(incomingShares)
            .set({
              encryptedData: env.encryptedData,
              nonce: env.nonce,
            })
            .where(
              and(
                eq(incomingShares.userId, recipientUserId),
                eq(incomingShares.senderHandle, ownerHandle),
                eq(incomingShares.resourceType, 'collection'),
                eq(incomingShares.resourceId, params.collectionId),
              ),
            )
        }
      }
    }

    // 4. Delete revoked shares entirely. Both outgoing (owner side) and
    //    incoming (recipient side) rows go in one sweep.
    for (const revoked of params.revokeRecipientHandles) {
      await tx
        .delete(shares)
        .where(
          and(
            eq(shares.userId, params.userId),
            eq(shares.resourceType, 'collection'),
            eq(shares.resourceId, params.collectionId),
            eq(shares.recipientHandle, revoked),
          ),
        )

      if (ownerHandle) {
        const recipientUserId = await resolveLocalRecipientUserId(tx, revoked)
        if (recipientUserId) {
          await tx
            .delete(incomingShares)
            .where(
              and(
                eq(incomingShares.userId, recipientUserId),
                eq(incomingShares.senderHandle, ownerHandle),
                eq(incomingShares.resourceType, 'collection'),
                eq(incomingShares.resourceId, params.collectionId),
              ),
            )
        }
      }
    }

    return updatedCollection ?? null
  })
  if (result) {
    await emit.collection('collection:rotated', result, result.id)
  }
  return result
}

// ===== Scheme switch (server-key ↔ user-e2ee) =====

export interface ChangeCollectionSchemeParams {
  collectionId: string
  userId: string
  targetScheme: 'server-key' | 'user-e2ee'
  newMetadataEncrypted: string
  newMetadataKeyVersion: number

  /**
   * UPGRADE (server-key → user-e2ee): the client has already encrypted
   * every existing bookmark under the new collection key. We insert these
   * as encrypted_points and tear down the cleartext bookmarks.
   */
  newEncryptedPoints?: Array<{
    id?: string
    encryptedData: string
    nonce: string
  }>

  /**
   * DOWNGRADE (user-e2ee → server-key): the client decrypted every
   * encrypted_point and now hands us plaintext bookmark rows to insert.
   * The spatial coordinate is sent as separate lat/lng so the server can
   * regenerate PostGIS geometry from the pair.
   */
  newBookmarks?: Array<{
    id?: string
    externalIds: Record<string, string>
    name: string
    address?: string | null
    lat: number
    lng: number
    icon?: string
    iconColor?: string
    presetType?: string | null
  }>

  /** Rewrapped per-recipient share envelopes after the scheme change. */
  updatedShareEnvelopes: Array<{
    recipientHandle: string
    encryptedData: string
    nonce: string
  }>

  /**
   * Compare-and-swap token. When provided, the server refuses the switch if
   * the collection's current `updated_at` doesn't match. This prevents two
   * concurrent devices from racing scheme changes and silently clobbering
   * each other — whichever one loses the CAS must refetch and rebuild its
   * rotation bundle against the fresh state. ISO-8601 string to avoid
   * timezone-trip bugs crossing the JSON boundary.
   */
  expectedUpdatedAt?: string
}

/**
 * Thrown when the caller requests a no-op scheme change (current scheme
 * equals target). Maps to 400.
 */
export class SchemeAlreadySetError extends Error {
  constructor(scheme: 'server-key' | 'user-e2ee') {
    super(`Collection scheme is already ${scheme}`)
    this.name = 'SchemeAlreadySetError'
  }
}

/**
 * Thrown when the CAS check on `updated_at` fails during a scheme switch.
 * Controllers map this to 409 Conflict — the client should refetch and
 * rebuild its rotation bundle before retrying.
 */
export class CollectionVersionConflictError extends Error {
  constructor(current: Date, expected: string) {
    super(
      `Collection has been modified since ${expected} (current updated_at: ${current.toISOString()})`,
    )
    this.name = 'CollectionVersionConflictError'
  }
}

/**
 * Change a collection's encryption scheme atomically.
 *
 * Upgrade (server-key → user-e2ee):
 *   - Delete the cleartext `bookmarks` rows in the collection (and their
 *     pivots) — the client packaged their data into the new encrypted_points
 *     batch so the cleartext copies are no longer needed.
 *   - Insert the new encrypted_points.
 *   - Flip `scheme`, clear any public link (disallowed on user-e2ee), and
 *     mirror `is_sensitive=true` for the compat shim.
 *
 * Downgrade (user-e2ee → server-key):
 *   - Delete all encrypted_points for the collection.
 *   - Insert new `bookmarks` rows + `bookmarks_collections` pivot entries
 *     from the plaintext payload.
 *   - Flip `scheme` + `is_sensitive=false`.
 *
 * Both paths also:
 *   - Update the collection metadata envelope + bump `metadata_key_version`.
 *   - Update every remaining share's rewrapped envelope.
 *
 * Owner-only. Returns the updated collection; null when not found.
 */
export async function changeCollectionScheme(
  params: ChangeCollectionSchemeParams,
): Promise<Collection | null> {
  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(collections)
      .where(
        and(
          eq(collections.id, params.collectionId),
          eq(collections.userId, params.userId),
        ),
      )
      .limit(1)
    if (!current) return null

    if (current.scheme === params.targetScheme) {
      throw new SchemeAlreadySetError(params.targetScheme)
    }

    // CAS guard: if the caller staged this rotation against a specific
    // snapshot of the collection, refuse to apply when the row has moved.
    // Compare Date-object times rather than ISO strings — Postgres can emit
    // slightly different ISO formats than JavaScript Date.toISOString().
    if (params.expectedUpdatedAt !== undefined) {
      const expectedMs = Date.parse(params.expectedUpdatedAt)
      if (
        Number.isNaN(expectedMs) ||
        current.updatedAt.getTime() !== expectedMs
      ) {
        throw new CollectionVersionConflictError(
          current.updatedAt,
          params.expectedUpdatedAt,
        )
      }
    }

    // Collection-level swap is the same in both directions.
    const [updatedCollection] = await tx
      .update(collections)
      .set({
        scheme: params.targetScheme,
        isSensitive: params.targetScheme === 'user-e2ee',
        metadataEncrypted: params.newMetadataEncrypted,
        metadataKeyVersion: params.newMetadataKeyVersion,
        // Public links are only allowed on server-key. Downgrading preserves
        // whatever token existed (or null); upgrading clears any token.
        publicToken:
          params.targetScheme === 'user-e2ee' ? null : current.publicToken,
        publicRole:
          params.targetScheme === 'user-e2ee' ? null : current.publicRole,
        updatedAt: new Date(),
      })
      .where(eq(collections.id, params.collectionId))
      .returning()

    if (params.targetScheme === 'user-e2ee') {
      // --- UPGRADE: cleartext bookmarks → encrypted_points ---
      // Get bookmark ids linked to this collection so we can clean them up.
      const links = await tx
        .select({ bookmarkId: bookmarksCollections.bookmarkId })
        .from(bookmarksCollections)
        .where(eq(bookmarksCollections.collectionId, params.collectionId))
      const bookmarkIds = links.map((l) => l.bookmarkId)

      await tx
        .delete(bookmarksCollections)
        .where(eq(bookmarksCollections.collectionId, params.collectionId))

      // Delete the bookmarks themselves — they belonged only to this
      // collection. If a bookmark somehow also lived in another server-key
      // collection, the FK cascade on bookmarks_collections would already
      // have removed its tie here and the bookmark row stays put (we only
      // delete bookmarks whose user_id matches and that were in our list).
      if (bookmarkIds.length > 0) {
        await tx
          .delete(bookmarksSchema)
          .where(
            and(
              eq(bookmarksSchema.userId, params.userId),
              inArray(bookmarksSchema.id, bookmarkIds),
            ),
          )
      }

      if (params.newEncryptedPoints && params.newEncryptedPoints.length > 0) {
        await tx.insert(encryptedPoints).values(
          params.newEncryptedPoints.map((p) => ({
            id: p.id ?? generateId(),
            collectionId: params.collectionId,
            userId: params.userId,
            encryptedData: p.encryptedData,
            nonce: p.nonce,
          })),
        )
      }
    } else {
      // --- DOWNGRADE: encrypted_points → cleartext bookmarks ---
      await tx
        .delete(encryptedPoints)
        .where(eq(encryptedPoints.collectionId, params.collectionId))

      if (params.newBookmarks && params.newBookmarks.length > 0) {
        // Insert bookmarks. Geometry is built from lat/lng on the DB side
        // using the existing spatial helper shape (raw SQL since drizzle
        // doesn't model ST_MakePoint ergonomically).
        for (const bm of params.newBookmarks) {
          const bookmarkId = bm.id ?? generateId()
          await tx.execute(
            sql`INSERT INTO bookmarks
              (id, external_ids, name, address, geometry, icon, icon_color, preset_type, user_id)
              VALUES (
                ${bookmarkId},
                ${JSON.stringify(bm.externalIds)}::jsonb,
                ${bm.name},
                ${bm.address ?? null},
                ST_SetSRID(ST_MakePoint(${bm.lng}, ${bm.lat}), 4326),
                ${bm.icon ?? 'map-pin'},
                ${bm.iconColor ?? '#F43F5E'},
                ${bm.presetType ?? null},
                ${params.userId}
              )`,
          )
          await tx.insert(bookmarksCollections).values({
            bookmarkId,
            collectionId: params.collectionId,
          })
        }
      }
    }

    // Rewrap each remaining share's envelope under the new collection key.
    // Same mechanics as rotate-key — the server is opaque to the key; we
    // just swap stored ciphertext atomically.
    const ownerHandle = await getOwnerHandle(tx, params.userId)
    for (const env of params.updatedShareEnvelopes) {
      await tx
        .update(shares)
        .set({
          encryptedData: env.encryptedData,
          nonce: env.nonce,
        })
        .where(
          and(
            eq(shares.userId, params.userId),
            eq(shares.resourceType, 'collection'),
            eq(shares.resourceId, params.collectionId),
            eq(shares.recipientHandle, env.recipientHandle),
          ),
        )

      // Mirror on the same-server recipient's incoming_shares row. Rows
      // are keyed by (recipient user_id, owner handle as sender_handle) —
      // the old code compared sender_handle to the RECIPIENT's handle by
      // mistake and never matched.
      if (ownerHandle) {
        const recipientUserId = await resolveLocalRecipientUserId(
          tx,
          env.recipientHandle,
        )
        if (recipientUserId) {
          await tx
            .update(incomingShares)
            .set({
              encryptedData: env.encryptedData,
              nonce: env.nonce,
            })
            .where(
              and(
                eq(incomingShares.userId, recipientUserId),
                eq(incomingShares.senderHandle, ownerHandle),
                eq(incomingShares.resourceType, 'collection'),
                eq(incomingShares.resourceId, params.collectionId),
              ),
            )
        }
      }
    }

    return updatedCollection ?? null
  })
  if (result) {
    await emit.collection('collection:scheme-changed', result, result.id)
  }
  return result
}

// ===== Public Link Sharing =====

/**
 * Thrown when a public-link operation is attempted on a user-e2ee
 * collection. Controllers map this to 400.
 */
export class PublicLinkNotAllowedOnE2eeError extends Error {
  constructor() {
    super('Public links are only allowed on server-key collections')
    this.name = 'PublicLinkNotAllowedOnE2eeError'
  }
}

/**
 * Mint a public-link token on a collection. Owner-only, server-key only.
 *
 * If a token already exists, returns the existing one (idempotent). Use
 * `revokePublicLink` + `createPublicLink` to rotate.
 */
export async function createPublicLink(
  collectionId: string,
  userId: string,
): Promise<{ publicToken: string; publicRole: 'viewer' } | null> {
  const collection = await getCollectionById(collectionId, userId)
  if (!collection) return null
  if (collection.scheme !== 'server-key') {
    throw new PublicLinkNotAllowedOnE2eeError()
  }
  if (collection.publicToken) {
    return {
      publicToken: collection.publicToken,
      publicRole: 'viewer',
    }
  }

  // 32 random bytes → base64url (no padding). Plenty of entropy; unguessable.
  const token = randomBytes(32).toString('base64url')

  const [updated] = await db
    .update(collections)
    .set({
      publicToken: token,
      publicRole: 'viewer',
      updatedAt: new Date(),
    })
    .where(and(eq(collections.id, collectionId), eq(collections.userId, userId)))
    .returning()
  if (!updated) return null

  // Public-link changes fan out to the owner only (anonymous viewers are
  // stateless and refetch). This keeps their other open tabs in sync.
  await emit.publicLink(
    'collection:public-link-changed',
    updated,
    collectionId,
  )

  return { publicToken: token, publicRole: 'viewer' }
}

/**
 * Revoke the public-link token on a collection. Owner-only.
 *
 * After revoke, the old token resolves to 404. No rotation — revoke then
 * mint anew if a new token is needed.
 */
export async function revokePublicLink(
  collectionId: string,
  userId: string,
): Promise<boolean> {
  const [updated] = await db
    .update(collections)
    .set({
      publicToken: null,
      publicRole: null,
      updatedAt: new Date(),
    })
    .where(and(eq(collections.id, collectionId), eq(collections.userId, userId)))
    .returning()
  if (updated) {
    await emit.publicLink(
      'collection:public-link-changed',
      updated,
      collectionId,
    )
  }
  return !!updated
}

/**
 * Resolve a public-link token to its collection + bookmarks. Called by the
 * unauthenticated `GET /public/collections/:token` endpoint.
 *
 * Returns null when the token doesn't match (revoked, never existed, or
 * the collection switched to user-e2ee and had its token cleared). Caller
 * translates null to 404.
 */
export async function getPublicCollectionByToken(token: string) {
  const [collection] = await db
    .select()
    .from(collections)
    .where(eq(collections.publicToken, token))
    .limit(1)
  if (!collection) return null

  // Defense in depth — the scheme guard is also on the mint path, but if
  // a future migration flips scheme without clearing the token, we still
  // refuse to serve.
  if (collection.scheme !== 'server-key') return null

  const bookmarkLinks = await db
    .select({ bookmarkId: bookmarksCollections.bookmarkId })
    .from(bookmarksCollections)
    .where(eq(bookmarksCollections.collectionId, collection.id))

  const bookmarkIds = bookmarkLinks.map((link) => link.bookmarkId)
  const bookmarks = bookmarkIds.length
    ? await db
        .select(bookmarkSelectFields)
        .from(bookmarksSchema)
        .where(inArray(bookmarksSchema.id, bookmarkIds))
    : []

  return {
    collection,
    bookmarks,
  }
}
