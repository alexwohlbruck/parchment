/**
 * Local-socket subscriber: fans out realtime events to every WebSocket
 * connection owned by one of the event's local recipients.
 *
 * This is the default subscriber that makes in-browser realtime work.
 * Federation is a separate subscriber (see federation.subscriber.ts);
 * the two can ship independently.
 */

import { logger } from '../../lib/logger'
import type {
  EventSubscriber,
  RealtimeEvent,
  Recipients,
} from './event-bus.service'
import { socketsForUser, removeById } from './registry.service'

export const localSocketSubscriber: EventSubscriber = {
  name: 'local-socket',
  deliver(event: RealtimeEvent, recipients: Recipients): void {
    if (recipients.localUserIds.length === 0) return

    // One JSON frame per event; identical bytes delivered to every socket.
    // Build once to avoid re-serializing for every recipient.
    const frame = JSON.stringify({
      id: event.id,
      event: event.event,
      timestamp: event.timestamp,
      payload: event.payload,
    })

    for (const userId of recipients.localUserIds) {
      const sockets = socketsForUser(userId)
      for (const conn of sockets) {
        try {
          conn.send(frame)
        } catch (err) {
          // Backpressure or a mid-close socket — drop it from the registry
          // so the next publish doesn't retry the same dead reference. The
          // client will reconnect and refetch its stores on its own.
          logger.debug(
            { err, userId, event: event.event, connectionId: conn.id },
            'Dropping WS after send failure',
          )
          try {
            conn.close?.(1011, 'Send failed')
          } catch {
            // close() can throw on an already-dead socket; ignore.
          }
          removeById(conn.id)
        }
      }
    }
  },
}
