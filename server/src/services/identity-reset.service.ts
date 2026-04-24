/**
 * Identity reset (last-resort account recovery).
 *
 * When a user has lost every way of getting their master seed back
 * (no recovery key, no working passkey with a slot, no other signed-in
 * device to transfer from), the only path forward is a clean-slate
 * reset. Everything encrypted under the old seed is deleted — there is
 * no way to decrypt it without the seed — and the user's federation
 * identity is wiped so they can register a fresh one.
 *
 * What STAYS:
 *   - The user row itself (email, display name, profile picture).
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
 *   - `alias` — old alias was tied to public keys that peers pinned;
 *     a re-pin would reject under the new keys.
 *   - `signingKey`, `encryptionKey` — will be re-registered when the
 *     client generates a fresh seed.
 *   - `kmVersion` → 1.
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
    // verify against the new identity key, and peers have the old
    // signingKey pinned. Clean slate is the only recovery story.
    //
    // Friendships are one-sided in this schema — the "friend" side lives
    // under the peer's handle, not as a FK. Both sides' rows get wiped
    // when each user does their own reset; the peer sees a broken
    // friendship on next federation ping.
    await tx.delete(friendships).where(eq(friendships.userId, userId))
    await tx
      .delete(friendInvitations)
      .where(eq(friendInvitations.localUserId, userId))

    // Finally, null the seed-derived identity fields on the user row and
    // reset kmVersion. The NEXT `PUT /users/me/keys` call (from the fresh
    // setup flow) writes the new signing + encryption keys.
    await tx
      .update(users)
      .set({
        alias: null,
        signingKey: null,
        encryptionKey: null,
        kmVersion: 1,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
  })
}
