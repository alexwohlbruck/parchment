/**
 * Inbound handler for the `REALTIME_EVENT` federation message.
 *
 * A peer server tells us: "event X, payload Y, should be delivered to
 * these local aliases." We resolve each alias to a userId on THIS server,
 * then re-publish through the event bus so the local-socket subscriber
 * fans it out to those users' connected tabs.
 *
 * Security:
 *   - The S2S auth layer (see federation-auth.service.ts) has already
 *     verified the calling server's signature + pin before dispatch
 *     reaches this handler — so we trust `senderHandle` to identify a
 *     real peer, just not a specific user.
 *   - Before dispatching, we check that each recipient alias actually
 *     has an accepted friendship row with the sender's handle. A peer
 *     can't spam our users with realtime events for people they're not
 *     friends with.
 *   - The `recipients.remoteHandles` on the re-published event is empty
 *     — we DO NOT forward further. Otherwise a two-peer cycle could
 *     amplify indefinitely.
 */

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../db'
import { users } from '../../schema/users.schema'
import { friendships } from '../../schema/friendships.schema'
import { publish } from './event-bus.service'
import { logger } from '../../lib/logger'

export async function handleIncomingRealtimeEvent(
  senderHandle: string,
  eventType: string,
  eventPayload: unknown,
  recipientAliases: string[],
): Promise<{ success: boolean; error?: string }> {
  if (recipientAliases.length === 0) return { success: true }

  // Resolve aliases → userIds. Missing users (alias doesn't exist here)
  // are silently dropped.
  const localUsers = await db
    .select({ id: users.id, alias: users.alias })
    .from(users)
    .where(inArray(users.alias, recipientAliases))

  if (localUsers.length === 0) return { success: true }

  // Friendship gate: only accept events for users who are currently
  // friends with the sender. Stops a peer from pushing updates to
  // arbitrary users they don't have a relationship with.
  const allowedUserIds: string[] = []
  for (const u of localUsers) {
    const [fs] = await db
      .select({ id: friendships.id })
      .from(friendships)
      .where(
        and(
          eq(friendships.userId, u.id),
          eq(friendships.friendHandle, senderHandle),
          eq(friendships.status, 'accepted'),
        ),
      )
      .limit(1)
    if (fs) allowedUserIds.push(u.id)
  }

  if (allowedUserIds.length === 0) {
    logger.debug(
      { senderHandle, eventType },
      'Realtime event from peer had no authorized local recipients',
    )
    return { success: true }
  }

  // Re-publish locally only — remoteHandles intentionally empty so we
  // don't forward back out.
  publish(eventType, eventPayload, {
    localUserIds: allowedUserIds,
    remoteHandles: [],
  })

  return { success: true }
}
