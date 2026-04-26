/**
 * Recipient resolvers for realtime events.
 *
 * Each function takes a resource id (or identity) and returns the set of
 * users who should receive live updates about changes to that resource.
 * Splits the result into:
 *
 *   - `localUserIds`: users on THIS server. The local-socket subscriber
 *     fans out to their open WebSockets.
 *   - `remoteHandles`: `alias@peer.server` handles of cross-server
 *     recipients. The federation subscriber (Phase 4) forwards one
 *     `REALTIME_EVENT` per peer so their home server can dispatch locally.
 *
 * The rule of thumb:
 *   - Owners always receive their own events (across all their devices).
 *   - Shared resources also include every incoming_shares recipient.
 *   - Friendship events go to both sides.
 *   - Profile changes go to everyone who has THIS user as a friend, so
 *     display names stay in sync in friend lists.
 *
 * These resolvers are called from write paths — they must be fast and
 * avoid blocking the caller's mutation response. A single indexed SELECT
 * per resolver is the target.
 */

import { and, eq, or } from 'drizzle-orm'
import { db } from '../../db'
import { collections, bookmarksCollections } from '../../schema/library.schema'
import { shares, incomingShares } from '../../schema/shares.schema'
import { friendships } from '../../schema/friendships.schema'
import { isLocalHandle } from '../federation.service'
import type { Recipients } from './event-bus.service'

/**
 * Split a list of recipient handles into (localUserIds, remoteHandles).
 * Local handles are resolved to userIds via a single `users` lookup by
 * alias. Remote handles pass through unchanged.
 *
 * Kept as a helper so every resolver that starts from a handle list
 * can split consistently.
 */
async function splitHandles(
  handles: string[],
): Promise<{ localUserIds: string[]; remoteHandles: string[] }> {
  if (handles.length === 0) return { localUserIds: [], remoteHandles: [] }

  const localAliases: string[] = []
  const remoteHandles: string[] = []
  for (const handle of handles) {
    if (isLocalHandle(handle)) {
      const [alias] = handle.split('@')
      if (alias) localAliases.push(alias)
    } else {
      remoteHandles.push(handle)
    }
  }

  if (localAliases.length === 0) {
    return { localUserIds: [], remoteHandles }
  }

  const { users } = await import('../../schema/users.schema')
  const { inArray } = await import('drizzle-orm')
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.alias, localAliases))
  return { localUserIds: rows.map((r) => r.id), remoteHandles }
}

const EMPTY: Recipients = { localUserIds: [], remoteHandles: [] }

/**
 * Collection owner + every user with an active incoming_shares row on it.
 * Used for collection CRUD, scheme changes, rotation, encrypted_points.
 */
export async function resolveCollectionRecipients(
  collectionId: string,
): Promise<Recipients> {
  const [collection] = await db
    .select({ userId: collections.userId })
    .from(collections)
    .where(eq(collections.id, collectionId))
    .limit(1)
  if (!collection) return EMPTY

  const localUserIds = new Set<string>([collection.userId])

  // Same-server recipients via incoming_shares.
  const sameServerRows = await db
    .select({ userId: incomingShares.userId })
    .from(incomingShares)
    .where(
      and(
        eq(incomingShares.resourceType, 'collection'),
        eq(incomingShares.resourceId, collectionId),
        or(
          eq(incomingShares.status, 'accepted'),
          eq(incomingShares.status, 'pending'),
        ),
      ),
    )
  for (const row of sameServerRows) localUserIds.add(row.userId)

  // Cross-server recipients via the owner's outgoing shares table — their
  // recipientUserId is null (since they're remote) but recipientHandle is
  // set. We only need the handle for federation forwarding.
  const outgoingRows = await db
    .select({ handle: shares.recipientHandle })
    .from(shares)
    .where(
      and(
        eq(shares.userId, collection.userId),
        eq(shares.resourceType, 'collection'),
        eq(shares.resourceId, collectionId),
      ),
    )

  const remoteHandles: string[] = []
  for (const row of outgoingRows) {
    if (!isLocalHandle(row.handle)) remoteHandles.push(row.handle)
  }

  return {
    localUserIds: Array.from(localUserIds),
    remoteHandles,
  }
}

/**
 * Collections a bookmark lives in → union of their recipients. Used for
 * bookmark CRUD events so every collection that contains the bookmark
 * sees the update.
 */
export async function resolveBookmarkRecipients(
  bookmarkId: string,
): Promise<Recipients> {
  const links = await db
    .select({ collectionId: bookmarksCollections.collectionId })
    .from(bookmarksCollections)
    .where(eq(bookmarksCollections.bookmarkId, bookmarkId))

  if (links.length === 0) return EMPTY

  // Walk every collection the bookmark is in and take the union. Duplicates
  // are dropped via Set semantics.
  const localUserIds = new Set<string>()
  const remoteHandles = new Set<string>()
  for (const { collectionId } of links) {
    const r = await resolveCollectionRecipients(collectionId)
    for (const u of r.localUserIds) localUserIds.add(u)
    for (const h of r.remoteHandles) remoteHandles.add(h)
  }

  return {
    localUserIds: Array.from(localUserIds),
    remoteHandles: Array.from(remoteHandles),
  }
}

/**
 * Recipients for a specific list of collection ids — used when a bookmark
 * is being removed (we can't look it up by bookmark id anymore once it's
 * gone) or assigned to a fresh collection list.
 */
export async function resolveRecipientsForCollections(
  collectionIds: string[],
): Promise<Recipients> {
  if (collectionIds.length === 0) return EMPTY
  const localUserIds = new Set<string>()
  const remoteHandles = new Set<string>()
  for (const id of collectionIds) {
    const r = await resolveCollectionRecipients(id)
    for (const u of r.localUserIds) localUserIds.add(u)
    for (const h of r.remoteHandles) remoteHandles.add(h)
  }
  return {
    localUserIds: Array.from(localUserIds),
    remoteHandles: Array.from(remoteHandles),
  }
}

/**
 * Recipients of a friendship event. Bidirectional: both users see the
 * update. `userIdA` is always local (the mutation happened here);
 * `partner` may be a local userId or a remote handle.
 */
export async function resolveFriendshipRecipients(
  userIdA: string,
  partner: { userId?: string; handle?: string },
): Promise<Recipients> {
  const localUserIds = [userIdA]
  const remoteHandles: string[] = []

  if (partner.userId) {
    localUserIds.push(partner.userId)
  } else if (partner.handle) {
    if (isLocalHandle(partner.handle)) {
      const { users } = await import('../../schema/users.schema')
      const parsed = partner.handle.split('@')[0]
      const [row] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.alias, parsed))
        .limit(1)
      if (row) localUserIds.push(row.id)
    } else {
      remoteHandles.push(partner.handle)
    }
  }

  return { localUserIds, remoteHandles }
}

/**
 * Recipients for a user profile change: the user themselves (all their
 * devices) plus every friend of theirs (so display name / picture stays
 * fresh in friend lists).
 *
 * Returns the user's OWN id as a local recipient — useful when they're
 * viewing their own profile in another tab.
 */
export async function resolveUserProfileRecipients(
  userId: string,
): Promise<Recipients> {
  const localUserIds = new Set<string>([userId])
  const remoteHandles = new Set<string>()

  // Every friendship row where this user is the local side has the
  // friend's handle. We also need every OTHER user who has THIS user as
  // their friend — i.e. friendship rows elsewhere with friendHandle ===
  // this user's federated handle. That's a second query, split into local
  // (resolve to userId) and remote (leave as handle).
  const { users } = await import('../../schema/users.schema')
  const { inArray } = await import('drizzle-orm')

  const [me] = await db
    .select({ alias: users.alias })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!me?.alias) {
    return { localUserIds: [userId], remoteHandles: [] }
  }

  // Friendships FROM this user → follow the handle column.
  const outRows = await db
    .select({ handle: friendships.friendHandle })
    .from(friendships)
    .where(
      and(
        eq(friendships.userId, userId),
        eq(friendships.status, 'accepted'),
      ),
    )
  for (const row of outRows) {
    if (isLocalHandle(row.handle)) {
      const parsed = row.handle.split('@')[0]
      const [u] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.alias, parsed))
        .limit(1)
      if (u) localUserIds.add(u.id)
    } else {
      remoteHandles.add(row.handle)
    }
  }

  return {
    localUserIds: Array.from(localUserIds),
    remoteHandles: Array.from(remoteHandles),
  }
}

/**
 * Public-link events are owner-only (anonymous viewers can't be notified —
 * they're stateless and refetch on load). Kept as its own resolver for
 * symmetry with the rest.
 */
export async function resolvePublicLinkRecipients(
  collectionId: string,
): Promise<Recipients> {
  const [collection] = await db
    .select({ userId: collections.userId })
    .from(collections)
    .where(eq(collections.id, collectionId))
    .limit(1)
  if (!collection) return EMPTY
  return { localUserIds: [collection.userId], remoteHandles: [] }
}

// Helper for unit tests that want to seed before calling resolvers.
export { splitHandles as _splitHandlesForTests }
