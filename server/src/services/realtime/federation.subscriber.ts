/**
 * Federation subscriber: forwards events to remote peer servers so their
 * connected users' sockets get dispatched in near-real-time.
 *
 * Strategy:
 *   1. Group `remoteHandles` by peer host (alias@peer.server → peer.server).
 *   2. For each peer, send ONE `REALTIME_EVENT` federation message
 *      carrying the event type, payload, and the list of recipient
 *      aliases on that peer.
 *   3. The peer's inbound handler verifies friendship with each alias
 *      and republishes locally.
 *
 * Fire-and-forget: a peer being unreachable doesn't fail the sender's
 * mutation. The recipient's next REST fetch will converge state.
 *
 * Known trade-offs (v1):
 *   - No retry queue. Events lost to transient network failures stay
 *     lost until the user's client refetches. Documented in the plan.
 *   - No per-message signing. The S2S wrapper auth (server signs the
 *     HTTP request) is sufficient to bind the event to a trusted peer,
 *     but the PAYLOAD isn't individually signed by the originating user.
 *     An attacker with control of a peer could spoof events from any of
 *     their users. Upgrade path: sign the payload with the originating
 *     user's Ed25519 key, same v2 pattern as RESOURCE_SHARE.
 */

import type {
  EventSubscriber,
  RealtimeEvent,
  Recipients,
} from './event-bus.service'
import {
  sendFederationMessage,
  buildHandle,
  type FederationMessage,
} from '../federation.service'
import { parseHandle } from '../../lib/crypto'
import { db } from '../../db'
import { logger } from '../../lib/logger'
import { eq } from 'drizzle-orm'
import { users } from '../../schema/users.schema'

/**
 * Figure out which local user the event is originating from so we can
 * set `from` on the federation message correctly. For events that touch
 * multiple local users (rare — most events have one originator) we just
 * use the first local userId as the sender attribution.
 */
async function resolveSenderHandle(
  localUserIds: string[],
): Promise<string | null> {
  if (localUserIds.length === 0) return null
  const [u] = await db
    .select({ alias: users.alias })
    .from(users)
    .where(eq(users.id, localUserIds[0]))
    .limit(1)
  if (!u?.alias) return null
  return buildHandle(u.alias)
}

/**
 * Bucket a list of `alias@peer.server` handles by peer host.
 * Returns Map<peerHost, aliases[]>.
 */
function groupByPeer(remoteHandles: string[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>()
  for (const handle of remoteHandles) {
    const parsed = parseHandle(handle)
    if (!parsed) continue
    const list = grouped.get(parsed.domain) ?? []
    list.push(parsed.alias)
    grouped.set(parsed.domain, list)
  }
  return grouped
}

export const federationSubscriber: EventSubscriber = {
  name: 'federation',
  async deliver(event: RealtimeEvent, recipients: Recipients): Promise<void> {
    if (recipients.remoteHandles.length === 0) return

    const senderHandle = await resolveSenderHandle(recipients.localUserIds)
    if (!senderHandle) {
      // Can't identify an originator — skip forwarding rather than send
      // a message with no `from`. Shouldn't happen in practice since
      // every write goes through an authenticated local user.
      logger.debug(
        { event: event.event },
        'Skipping federation forward — no local originator',
      )
      return
    }

    const byPeer = groupByPeer(recipients.remoteHandles)
    for (const [peerHost, aliases] of byPeer) {
      const message: FederationMessage = {
        type: 'REALTIME_EVENT',
        from: senderHandle,
        // `to` is required by the envelope but a REALTIME_EVENT is
        // multi-cast to multiple aliases on the peer — we set it to the
        // first alias for envelope validity and carry the full list in
        // payload.recipientAliases.
        to: `${aliases[0]}@${peerHost}`,
        timestamp: new Date().toISOString(),
        signature: '',
        payload: {
          eventType: event.event,
          eventPayload: event.payload,
          recipientAliases: aliases,
        },
      }
      // Fire-and-forget. A failure logs but doesn't retry; the recipient
      // will refetch on reconnect or next interaction.
      sendFederationMessage(message.to, message).catch((err) => {
        logger.debug(
          { err, peerHost, event: event.event },
          'Federation forward of realtime event failed',
        )
      })
    }
  },
}
