/**
 * Generic event bus for server-side mutations that should propagate to
 * interested consumers.
 *
 * The bus itself is transport-agnostic: it just accepts events + a set of
 * recipients and dispatches to every registered subscriber. Subscribers
 * decide how to actually deliver — the shipping v1 has a local-socket
 * subscriber (fans out to connected WebSockets) and a federation subscriber
 * (forwards to peer servers). Future: a webhook subscriber for external
 * integrations.
 *
 * Design constraints:
 *
 * 1. Fire-and-forget. Callers MUST NOT await the bus — publish returns
 *    synchronously. Each subscriber handles its own async + retries.
 *    Rationale: write endpoints shouldn't block on a flaky peer's inbox
 *    or on a dead WebSocket's backpressure.
 * 2. One idempotency id per event. Webhooks in particular need this for
 *    consumer-side dedup when we retry deliveries.
 * 3. Never throws back to the publisher. If a subscriber blows up, we log
 *    it but the user's mutation still succeeds — realtime is best-effort.
 */

import { randomUUID } from 'node:crypto'
import { logger } from '../../lib/logger'

/**
 * Recipients of an event. `localUserIds` are resolved on this server and
 * will be dispatched to their open sockets via the local subscriber.
 * `remoteHandles` are federation handles (`alias@peer.server`) whose owning
 * server should receive a forwarded copy and then dispatch locally on its
 * end.
 */
export interface Recipients {
  localUserIds: string[]
  remoteHandles: string[]
}

/**
 * The envelope every subscriber sees. `id` is stable per logical event and
 * propagates unchanged across federation hops so downstream consumers can
 * dedupe. `timestamp` is the emit time from the originating server.
 */
export interface RealtimeEvent {
  id: string
  event: string
  timestamp: string
  payload: unknown
}

/**
 * One pluggable delivery channel. `deliver` is invoked for every published
 * event; the subscriber is responsible for any filtering (e.g. the
 * federation subscriber no-ops when `recipients.remoteHandles` is empty).
 */
export interface EventSubscriber {
  /** Short identifier for logs and tests. */
  readonly name: string
  deliver(event: RealtimeEvent, recipients: Recipients): Promise<void> | void
}

const subscribers: EventSubscriber[] = []

/**
 * Register a subscriber. Called once at module bootstrap per subscriber —
 * NOT for per-request wiring. Order doesn't matter; deliveries happen in
 * parallel.
 */
export function register(subscriber: EventSubscriber): void {
  subscribers.push(subscriber)
}

/**
 * Emit an event. Synchronous from the caller's POV — subscriber work runs
 * on the microtask queue. Every subscriber is invoked exactly once per
 * call; errors are caught and logged, never rethrown.
 */
export function publish(
  event: string,
  payload: unknown,
  recipients: Recipients,
): RealtimeEvent {
  const envelope: RealtimeEvent = {
    id: `evt_${randomUUID()}`,
    event,
    timestamp: new Date().toISOString(),
    payload,
  }

  // Detach subscriber dispatch from the caller's await chain. A subscriber
  // that takes 200ms to talk to a peer server must not stretch the caller's
  // request latency. Errors bubble up to the .catch, never to the caller.
  queueMicrotask(() => {
    for (const subscriber of subscribers) {
      Promise.resolve()
        .then(() => subscriber.deliver(envelope, recipients))
        .catch((err) => {
          logger.error(
            {
              err,
              subscriber: subscriber.name,
              event: envelope.event,
              eventId: envelope.id,
            },
            'Realtime subscriber delivery failed',
          )
        })
    }
  })

  return envelope
}

/**
 * Testing hook — clear registered subscribers. Never called in production.
 */
export function _resetForTests(): void {
  subscribers.length = 0
}

/**
 * Testing hook — read current subscriber names (diagnostic only).
 */
export function _listSubscribers(): string[] {
  return subscribers.map((s) => s.name)
}
