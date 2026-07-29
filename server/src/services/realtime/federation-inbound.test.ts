/**
 * Unit tests for the inbound federation realtime handler.
 *
 * The S2S layer has already proven WHICH peer is calling, but not that the
 * peer may reach a given local user. This handler is that gate: each recipient
 * alias is only served if it has an ACCEPTED friendship with the sender's
 * handle. Without it a peer could push arbitrary events to any user on this
 * server, so the pending/rejected and wrong-sender cases are covered
 * explicitly.
 *
 * The re-published event carries an empty `remoteHandles` on purpose — a
 * forwarded event that forwards again would amplify without bound between two
 * peers that share a recipient.
 *
 * Unknown aliases are dropped silently rather than reported: telling a peer
 * which aliases exist here would make the endpoint a user-enumeration oracle.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createDbMock } from '../../test/db-mock'

const dbMock = createDbMock()
mock.module('../../db', () => ({ db: dbMock.db }))

const publish = mock((_event: string, _payload: unknown, _recipients: unknown) => ({
  id: 'evt-1',
}))
mock.module('./event-bus.service', () => ({ publish }))

mock.module('../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
}))

const { handleIncomingRealtimeEvent } = await import('./federation-inbound')

const SENDER = 'bea@peer.test'

/**
 * Queue the alias lookup followed by one friendship lookup per resolved user.
 * `friendships` entries are the rows each per-user friendship query returns.
 */
function queueLookups(
  localUsers: { id: string; alias: string }[],
  friendships: unknown[][],
) {
  dbMock.queueSelect(localUsers)
  for (const rows of friendships) dbMock.queueSelect(rows)
}

const accepted = [{ id: 'fs-1' }]
const none: unknown[] = []

beforeEach(() => {
  dbMock.reset()
  publish.mockClear()
})

describe('authorized delivery', () => {
  test('republishes to a friend of the sender', async () => {
    queueLookups([{ id: 'u-1', alias: 'alex' }], [accepted])

    const result = await handleIncomingRealtimeEvent(
      SENDER,
      'collection:updated',
      { id: 'c-1' },
      ['alex'],
    )

    expect(result).toEqual({ success: true })
    expect(publish).toHaveBeenCalledWith('collection:updated', { id: 'c-1' }, {
      localUserIds: ['u-1'],
      remoteHandles: [],
    })
  })

  test('never forwards the event onward', async () => {
    // A peer cycle would otherwise amplify the event indefinitely.
    queueLookups([{ id: 'u-1', alias: 'alex' }], [accepted])

    await handleIncomingRealtimeEvent(SENDER, 'e', {}, ['alex'])

    expect(publish.mock.calls[0][2].remoteHandles).toEqual([])
  })

  test('serves several authorized recipients in one publish', async () => {
    queueLookups(
      [
        { id: 'u-1', alias: 'alex' },
        { id: 'u-2', alias: 'sam' },
      ],
      [accepted, accepted],
    )

    await handleIncomingRealtimeEvent(SENDER, 'e', {}, ['alex', 'sam'])

    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0][2].localUserIds).toEqual(['u-1', 'u-2'])
  })

  test('passes the payload through untouched', async () => {
    queueLookups([{ id: 'u-1', alias: 'alex' }], [accepted])
    const payload = { nested: { value: [1, 2, 3] } }

    await handleIncomingRealtimeEvent(SENDER, 'e', payload, ['alex'])

    expect(publish.mock.calls[0][1]).toBe(payload)
  })
})

describe('the friendship gate', () => {
  test('drops a recipient with no friendship to the sender', async () => {
    queueLookups([{ id: 'u-1', alias: 'alex' }], [none])

    const result = await handleIncomingRealtimeEvent(SENDER, 'e', {}, ['alex'])

    expect(result).toEqual({ success: true })
    expect(publish).not.toHaveBeenCalled()
  })

  test('serves only the authorized subset', async () => {
    queueLookups(
      [
        { id: 'u-1', alias: 'alex' },
        { id: 'u-2', alias: 'stranger' },
      ],
      [accepted, none],
    )

    await handleIncomingRealtimeEvent(SENDER, 'e', {}, ['alex', 'stranger'])

    expect(publish.mock.calls[0][2].localUserIds).toEqual(['u-1'])
  })

  test('checks the friendship once per resolved user', async () => {
    queueLookups(
      [
        { id: 'u-1', alias: 'alex' },
        { id: 'u-2', alias: 'sam' },
      ],
      [accepted, accepted],
    )

    await handleIncomingRealtimeEvent(SENDER, 'e', {}, ['alex', 'sam'])

    // One alias lookup plus one friendship lookup per user.
    expect(dbMock.selectCount).toBe(3)
  })
})

describe('silent drops', () => {
  test('accepts an empty recipient list without querying', async () => {
    const result = await handleIncomingRealtimeEvent(SENDER, 'e', {}, [])

    expect(result).toEqual({ success: true })
    expect(dbMock.selectCount).toBe(0)
    expect(publish).not.toHaveBeenCalled()
  })

  test('reports success for aliases that do not exist here', async () => {
    // Reporting the difference would turn this into a user-enumeration oracle.
    dbMock.queueSelect([])

    const result = await handleIncomingRealtimeEvent(SENDER, 'e', {}, [
      'nobody',
    ])

    expect(result).toEqual({ success: true })
    expect(publish).not.toHaveBeenCalled()
  })

  test('skips the friendship checks entirely when no alias resolves', async () => {
    dbMock.queueSelect([])

    await handleIncomingRealtimeEvent(SENDER, 'e', {}, ['nobody', 'nobody-else'])

    expect(dbMock.selectCount).toBe(1)
  })
})
