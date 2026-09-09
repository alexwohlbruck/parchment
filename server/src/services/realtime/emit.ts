/**
 * Thin ergonomic wrapper around `eventBus.publish`. Provides:
 *
 *   - A single import path for write-site callers.
 *   - Named convenience emitters keyed to each recipient resolver so the
 *     call-site reads naturally: `emit.collection('collection:updated', row)`.
 *
 * The resolver functions are async because they query the DB, so the
 * convenience emitters return a Promise — but the publish itself is still
 * fire-and-forget from the subscriber's POV. Callers typically don't need
 * to `await`: the event is queued for dispatch on the microtask queue.
 *
 * Using `await` at a call site is fine if you want to guarantee the event
 * is queued before the response is returned — otherwise it's optional.
 */

import { publish, type RealtimeEvent } from './event-bus.service'
import {
  resolveCollectionRecipients,
  resolveBookmarkRecipients,
  resolveRecipientsForCollections,
  resolveFriendshipRecipients,
  resolveUserProfileRecipients,
  resolvePublicLinkRecipients,
  resolveHandleRecipient,
} from './recipients.service'

export const emit = {
  /**
   * Emit an event for a collection. Recipients are the owner + every
   * incoming_shares recipient + any remote share handles.
   */
  async collection(event: string, payload: unknown, collectionId: string): Promise<RealtimeEvent> {
    const recipients = await resolveCollectionRecipients(collectionId)
    return publish(event, payload, recipients)
  },

  /**
   * Emit for a bookmark. Recipients are the union across every collection
   * the bookmark is linked to.
   */
  async bookmark(event: string, payload: unknown, bookmarkId: string): Promise<RealtimeEvent> {
    const recipients = await resolveBookmarkRecipients(bookmarkId)
    return publish(event, payload, recipients)
  },

  /**
   * Emit for a bookmark across a specific list of collection ids. Used on
   * delete paths where the bookmark row is gone and we already know which
   * collections it was in.
   */
  async bookmarkAcrossCollections(
    event: string,
    payload: unknown,
    collectionIds: string[],
  ): Promise<RealtimeEvent> {
    const recipients = await resolveRecipientsForCollections(collectionIds)
    return publish(event, payload, recipients)
  },

  /**
   * Emit for a friendship event. Both users receive it.
   */
  async friendship(
    event: string,
    payload: unknown,
    userIdA: string,
    partner: { userId?: string; handle?: string },
  ): Promise<RealtimeEvent> {
    const recipients = await resolveFriendshipRecipients(userIdA, partner)
    return publish(event, payload, recipients)
  },

  /**
   * Emit for a user profile change (alias/name/picture). Goes to the user
   * themselves and every friend.
   */
  async userProfile(event: string, payload: unknown, userId: string): Promise<RealtimeEvent> {
    const recipients = await resolveUserProfileRecipients(userId)
    return publish(event, payload, recipients)
  },

  /**
   * Emit for a public-link change on a collection. Owner only.
   */
  async publicLink(event: string, payload: unknown, collectionId: string): Promise<RealtimeEvent> {
    const recipients = await resolvePublicLinkRecipients(collectionId)
    return publish(event, payload, recipients)
  },

  /**
   * Emit for an encrypted location stored "for" a friend handle. Recipient
   * is that handle's owner (local userId or remote handle for federation).
   */
  async encryptedLocation(
    event: string,
    payload: unknown,
    forFriendHandle: string,
  ): Promise<RealtimeEvent> {
    const recipients = await resolveHandleRecipient(forFriendHandle)
    return publish(event, payload, recipients)
  },
}
