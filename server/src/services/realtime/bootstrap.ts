/**
 * Realtime bootstrap: wire every first-party subscriber into the event bus
 * at server startup. Importing this module for its side effect (in
 * index.ts after controller registration) is enough — no argument, no
 * return value. Keeping the wiring in one file makes it easy to see "who
 * subscribes to realtime events today" without grepping.
 */

import { register } from './event-bus.service'
import { localSocketSubscriber } from './local-socket.subscriber'
import { federationSubscriber } from './federation.subscriber'
import { setIntegrationManager } from '../transit/transit-poller.service'
import { integrationManager } from '../integrations'

let bootstrapped = false

export function bootstrapRealtime(): void {
  if (bootstrapped) return
  bootstrapped = true
  register(localSocketSubscriber)
  register(federationSubscriber)

  // Provide the integration manager to the transit poller so it can
  // look up the Barrelman host at poll time.
  setIntegrationManager(integrationManager)
}
