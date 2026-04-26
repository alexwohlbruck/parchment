/**
 * Identity reset (last-resort account recovery).
 *
 * When a user has lost every way of getting their master seed back
 * (no recovery key, no working passkey with a slot, no other signed-in
 * device to transfer from), the only path forward is a clean-slate
 * reset. Everything encrypted under the old seed is deleted — there is
 * no way to decrypt it without the seed — and the user's federation
 * identity keys are wiped so they can register a fresh pair.
 *
 * What STAYS:
 *   - The user row itself (email, display name, profile picture).
 *   - The `alias` — same handle, new keys. Peers resolve the handle
 *     live when verifying incoming signatures, so they pick up the new
 *     key automatically; we don't need to burn the handle to prove we
 *     rotated. Keeping it is what lets the user send signed
 *     RELATIONSHIP_REVOKE messages from the same `from:` to their old
 *     friends after re-registration.
 *   - Sessions (user stays signed in here).
 *   - Passkeys (can still be used to sign in; recovery slots are
 *     deleted, user can re-add them).
 *   - Role membership + preferences (not encrypted under the seed).
 *
 * What's DELETED (user-E2EE'd data):
 *   - Wrapped-master-key slots.
 *   - Device wrap secrets.
 *   - Personal blobs (search history, friend pins, etc.).
 *   - Bookmarks, collections, encrypted points, canvases.
 *   - Encrypted live-location rows.
 *   - Shares (outgoing + incoming).
 *   - Location-sharing configs + relationships + tracked devices.
 *   - Friendships + pending friend invitations (old signatures don't
 *     validate against the new identity key, and peers have the old
 *     key pinned).
 *
 * What's NULLED on the `users` row:
 *   - `signingKey`, `encryptionKey` — will be re-registered when the
 *     client generates a fresh seed.
 *   - `kmVersion` → 1.
 *
 * CLEANUP FAN-OUT: peers that had a friendship with us, that we shared
 * a collection with, or that shared one with us will otherwise be left
 * with orphaned rows pointing at a handle whose cryptographic identity
 * has changed under them. Right before the wipe we capture every
 * distinct peer handle from those tables into `pending_revocations`.
 * Once the user has set up a new seed and re-registered keys, the
 * client pulls that list and sends signed RELATIONSHIP_REVOKE messages
 * from the new key — peers resolve the handle, see the new key, verify
 * the signature, and delete their cached state. The fan-out happens
 * via a separate endpoint (`POST /users/me/revocations/flush`) because
 * it requires signatures the reset user can only produce after new-key
 * registration.
 */

import { eq, or } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../schema/users.schema'
import { wrappedMasterKeys } from '../schema/wrapped-master-keys.schema'
import { deviceWrapSecrets } from '../schema/device-wrap-secrets.schema'
import { encryptedUserBlobs } from '../schema/personal-blobs.schema'
import {
  bookmarks,
  collections,
  canvases,
} from '../schema/library.schema'
import {
  encryptedLocations,
  locationSharingConfig,
  locationSharingRelationships,
  trackedDevices,
  userEncryptionKeys,
  userDevices,
} from '../schema/location.schema'
import { shares, incomingShares } from '../schema/shares.schema'
import { friendships } from '../schema/friendships.schema'
import { friendInvitations } from '../schema/friend-invitations.schema'
import { pendingRevocations } from '../schema/pending-revocations.schema'
import { generateId } from '../util'

/**
 * Perform a full reset of the user's encrypted data and identity keys.
 * Caller must be the authenticated user (enforced at controller layer).
 *
 * Wrapped in a single transaction so a mid-reset failure (network blip,
 * pod restart) either wipes everything or nothing — never leaves the
 * account in a half-deleted state where e.g. the identity keys are
 * nulled but the old slots still exist.
 */
export async function resetUserIdentity(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Snapshot every peer handle we need to notify BEFORE the rows that
    // hold those handles are deleted. Dedupe across all three sources so
    // a user who was both a friend AND shared a collection doesn't get
    // two revokes.
    const peerHandles = new Set<string>()

    const friendRows = await tx
      .select({ handle: friendships.friendHandle })
      .from(friendships)
      .where(eq(friendships.userId, userId))
    for (const r of friendRows) peerHandles.add(r.handle)

    const outgoingShareRows = await tx
      .select({ handle: shares.recipientHandle })
      .from(shares)
      .where(eq(shares.userId, userId))
    for (const r of outgoingShareRows) peerHandles.add(r.handle)

    const incomingShareRows = await tx
      .select({ handle: incomingShares.senderHandle })
      .from(incomingShares)
      .where(eq(incomingShares.userId, userId))
    for (const r of incomingShareRows) peerHandles.add(r.handle)

    const invitationRows = await tx
      .select({
        fromHandle: friendInvitations.fromHandle,
        toHandle: friendInvitations.toHandle,
      })
      .from(friendInvitations)
      .where(eq(friendInvitations.localUserId, userId))
    // Grab whichever side of the invitation ISN'T us. The user's own
    // handle appears on one side; the peer on the other. Resolving that
    // from the row alone needs the user's current alias.
    const myAlias = (
      await tx
        .select({ alias: users.alias })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
    )[0]?.alias
    if (myAlias) {
      for (const r of invitationRows) {
        for (const h of [r.fromHandle, r.toHandle]) {
          // Cheap substring check — handles are "alias@domain", so the
          // row's "not-me" side is whichever one doesn't start with our
          // alias. Conservative: if in doubt, include it — an extra
          // revoke to ourselves is a no-op on the peer side.
          if (!h.startsWith(`${myAlias}@`)) peerHandles.add(h)
        }
      }
    }

    // Materialize. Ignore collisions if a prior aborted reset left rows
    // behind — the unique index on (userId, peerHandle) collapses dupes.
    if (peerHandles.size > 0) {
      await tx
        .insert(pendingRevocations)
        .values(
          Array.from(peerHandles).map((peerHandle) => ({
            id: generateId(),
            userId,
            peerHandle,
          })),
        )
        .onConflictDoNothing()
    }

    // Order matters only where FKs require it. We run each delete
    // explicitly rather than relying on cascades so the set of tables
    // touched is obvious from a single read.
    await tx.delete(wrappedMasterKeys).where(eq(wrappedMasterKeys.userId, userId))
    await tx.delete(deviceWrapSecrets).where(eq(deviceWrapSecrets.userId, userId))
    await tx
      .delete(encryptedUserBlobs)
      .where(eq(encryptedUserBlobs.userId, userId))

    // Library: deleting `collections` cascades to `bookmarks_collections`
    // and `encrypted_points` via schema FKs. Bookmarks themselves are a
    // separate per-user table.
    await tx.delete(collections).where(eq(collections.userId, userId))
    await tx.delete(bookmarks).where(eq(bookmarks.userId, userId))
    await tx.delete(canvases).where(eq(canvases.userId, userId))

    // Location / sharing state.
    await tx
      .delete(encryptedLocations)
      .where(eq(encryptedLocations.userId, userId))
    await tx
      .delete(locationSharingConfig)
      .where(eq(locationSharingConfig.userId, userId))
    // locationSharingRelationships is keyed by sharerId + viewerId rather
    // than a single userId — delete rows where the user is on either side.
    await tx
      .delete(locationSharingRelationships)
      .where(
        or(
          eq(locationSharingRelationships.sharerId, userId),
          eq(locationSharingRelationships.viewerId, userId),
        ),
      )
    await tx.delete(trackedDevices).where(eq(trackedDevices.userId, userId))
    await tx.delete(userDevices).where(eq(userDevices.userId, userId))
    await tx
      .delete(userEncryptionKeys)
      .where(eq(userEncryptionKeys.userId, userId))

    // Shares (outgoing + incoming).
    await tx.delete(shares).where(eq(shares.userId, userId))
    await tx.delete(incomingShares).where(eq(incomingShares.userId, userId))

    // Friend relationships: old Ed25519 signatures on these rows won't
    // verify against the new identity key. The peer's mirrored row is
    // left behind on their DB; the `pending_revocations` snapshot above
    // drives the cleanup fan-out.
    await tx.delete(friendships).where(eq(friendships.userId, userId))
    await tx
      .delete(friendInvitations)
      .where(eq(friendInvitations.localUserId, userId))

    // Finally, null the seed-derived identity keys and reset kmVersion.
    // Alias stays — peers will resolve it live and pick up the new
    // signingKey once `PUT /users/me/keys` lands the fresh pair.
    await tx
      .update(users)
      .set({
        signingKey: null,
        encryptionKey: null,
        kmVersion: 1,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
  })
}
