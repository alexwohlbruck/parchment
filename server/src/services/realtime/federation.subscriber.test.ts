/**
 * Unit tests for the federation subscriber.
 *
 * Forwarding is per-PEER, not per-recipient: every handle on the same host is
 * bundled into a single `REALTIME_EVENT` message carrying the full alias list.
 * Fanning out per handle instead would multiply S2S requests by the size of a
 * shared collection.
 *
 * The envelope's `to` field is required but semantically wrong for a multicast
 * message — it is set to the first alias for validity while the real recipient
 * list rides in `payload.recipientAliases`. The peer's inbound handler reads
 * the payload, so a change here without a matching change there silently drops
 * everyone but the first recipient.
 *
 * Delivery is fire-and-forget by design: an unreachable peer must not fail the
 * local user's mutation, and the recipient converges on their next fetch.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createDbMock } from '../../test/db-mock'

const dbMock = createDbMock()
mock.module('../../db', () => ({ db: dbMock.db }))

const sendFederationMessage = mock(async (_to: string, _message: unknown) => ({
  success: true,
}))

mock.module('../federation.service', () => ({
  sendFederationMessage,
  buildHandle: (alias: string) => `${alias}@local.test`,
}))

mock.module('../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
}))

const { federationSubscriber } = await import('./federation.subscriber')

const event = {
  id: 'evt-1',
  event: 'collection:updated',
  timestamp: '2026-01-01T00:00:00.000Z',
  payload: { id: 'c-1' },
}

/** The message sent to the peer at `index`. */
const messageAt = (index = 0) => sendFederationMessage.mock.calls[index][1] as any

beforeEach(() => {
  dbMock.reset()
  sendFederationMessage.mockClear()
  // Default: the originating local user resolves to alias "alex".
  dbMock.setSelectRows([{ alias: 'alex' }])
})

describe('forwarding', () => {
  test('sends one message per peer', async () => {
    await federationSubscriber.deliver(event as any, {
      localUserIds: ['u-1'],
      remoteHandles: ['bea@peer-a.test', 'cyd@peer-a.test', 'dee@peer-b.test'],
    })

    expect(sendFederationMessage).toHaveBeenCalledTimes(2)
  })

  test('bundles every alias on a host into one message', async () => {
    await federationSubscriber.deliver(event as any, {
      localUserIds: ['u-1'],
      remoteHandles: ['bea@peer-a.test', 'cyd@peer-a.test'],
    })

    expect(messageAt().payload.recipientAliases).toEqual(['bea', 'cyd'])
  })

  test('carries the event type and payload', async () => {
    await federationSubscriber.deliver(event as any, {
      localUserIds: ['u-1'],
      remoteHandles: ['bea@peer-a.test'],
    })

    expect(messageAt().payload).toMatchObject({
      eventType: 'collection:updated',
      eventPayload: { id: 'c-1' },
    })
  })

  test('attributes the message to the originating local user', async () => {
    await federationSubscriber.deliver(event as any, {
      localUserIds: ['u-1'],
      remoteHandles: ['bea@peer-a.test'],
    })

    expect(messageAt().from).toBe('alex@local.test')
    expect(messageAt().type).toBe('REALTIME_EVENT')
  })

  test('sets the envelope recipient to the first alias on the peer', async () => {
    // `to` is envelope bookkeeping; the real list is in the payload.
    await federationSubscriber.deliver(event as any, {
      localUserIds: ['u-1'],
      remoteHandles: ['bea@peer-a.test', 'cyd@peer-a.test'],
    })

    expect(messageAt().to).toBe('bea@peer-a.test')
    expect(sendFederationMessage.mock.calls[0][0]).toBe('bea@peer-a.test')
  })

  test('stamps the message with a timestamp', async () => {
    await federationSubscriber.deliver(event as any, {
      localUserIds: ['u-1'],
      remoteHandles: ['bea@peer-a.test'],
    })

    expect(typeof messageAt().timestamp).toBe('string')
  })

  test('identifies itself for registration', () => {
    expect(federationSubscriber.name).toBe('federation')
  })
})

describe('skipped cases', () => {
  test('does nothing when there are no remote recipients', async () => {
    await federationSubscriber.deliver(event as any, {
      localUserIds: ['u-1'],
      remoteHandles: [],
    })

    expect(sendFederationMessage).not.toHaveBeenCalled()
    expect(dbMock.selectCount).toBe(0)
  })

  test('skips forwarding when no local originator can be identified', async () => {
    // Sending with no `from` would give the peer nothing to authorize against.
    dbMock.setSelectRows([])

    await federationSubscriber.deliver(event as any, {
      localUserIds: ['u-1'],
      remoteHandles: ['bea@peer-a.test'],
    })

    expect(sendFederationMessage).not.toHaveBeenCalled()
  })

  test('skips forwarding when the originator has no alias', async () => {
    dbMock.setSelectRows([{ alias: null }])

    await federationSubscriber.deliver(event as any, {
      localUserIds: ['u-1'],
      remoteHandles: ['bea@peer-a.test'],
    })

    expect(sendFederationMessage).not.toHaveBeenCalled()
  })

  test('skips forwarding for an event with no local originator at all', async () => {
    await federationSubscriber.deliver(event as any, {
      localUserIds: [],
      remoteHandles: ['bea@peer-a.test'],
    })

    expect(sendFederationMessage).not.toHaveBeenCalled()
  })

  test('drops a malformed handle without dropping the rest', async () => {
    await federationSubscriber.deliver(event as any, {
      localUserIds: ['u-1'],
      remoteHandles: ['not-a-handle', 'bea@peer-a.test'],
    })

    expect(sendFederationMessage).toHaveBeenCalledTimes(1)
    expect(messageAt().to).toBe('bea@peer-a.test')
  })
})

describe('failure isolation', () => {
  test('does not reject when a peer is unreachable', async () => {
    // The local mutation must succeed even if forwarding fails.
    sendFederationMessage.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    await expect(
      federationSubscriber.deliver(event as any, {
        localUserIds: ['u-1'],
        remoteHandles: ['bea@peer-a.test'],
      }),
    ).resolves.toBeUndefined()
  })

  test('still forwards to the other peers when one fails', async () => {
    sendFederationMessage.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    await federationSubscriber.deliver(event as any, {
      localUserIds: ['u-1'],
      remoteHandles: ['bea@peer-a.test', 'dee@peer-b.test'],
    })

    expect(sendFederationMessage).toHaveBeenCalledTimes(2)
  })
})
