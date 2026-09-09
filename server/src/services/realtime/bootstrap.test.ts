/**
 * Unit tests for the realtime bootstrap.
 *
 * The wiring itself is trivial; the guard is not. `bootstrapRealtime` is
 * called for its side effect from `index.ts`, and the event bus keeps a plain
 * list of subscribers — so a second call would register both subscribers twice
 * and every event would be delivered twice to every socket. The idempotence
 * flag is module-level state, which is exactly the kind of thing that survives
 * a refactor unnoticed.
 */

import { describe, test, expect, mock } from 'bun:test'

const register = mock((_subscriber: unknown) => {})
const setIntegrationManager = mock((_manager: unknown) => {})
const integrationManager = { id: 'integration-manager' }

mock.module('./event-bus.service', () => ({ register }))
mock.module('./local-socket.subscriber', () => ({
  localSocketSubscriber: { name: 'local-socket', deliver: () => {} },
}))
mock.module('./federation.subscriber', () => ({
  federationSubscriber: { name: 'federation', deliver: async () => {} },
}))
mock.module('../transit/transit-poller.service', () => ({ setIntegrationManager }))
mock.module('../integrations', () => ({ integrationManager }))

const { bootstrapRealtime } = await import('./bootstrap')

describe('bootstrapRealtime', () => {
  test('registers both first-party subscribers', () => {
    bootstrapRealtime()

    expect(register.mock.calls.map(([s]: any) => s.name)).toEqual([
      'local-socket',
      'federation',
    ])
  })

  test('hands the integration manager to the transit poller', () => {
    // The poller needs it to look up the Barrelman host at poll time.
    expect(setIntegrationManager).toHaveBeenCalledWith(integrationManager)
  })

  test('is idempotent', () => {
    // A second registration would deliver every event twice to every socket.
    const callsBefore = register.mock.calls.length

    bootstrapRealtime()
    bootstrapRealtime()

    expect(register.mock.calls.length).toBe(callsBefore)
  })
})
