/**
 * Unit tests for the post-reset revocation fan-out.
 *
 * Two rules carry the security weight:
 *   - the client may only flush handles that were in the original snapshot,
 *     so this endpoint can't be used to send a RELATIONSHIP_REVOKE to an
 *     arbitrary peer;
 *   - the server never synthesizes a signature — it forwards the client's
 *     signed envelope verbatim. Delegating to server identity would let a
 *     compromised server erase its users' cross-server state.
 *
 * The retry semantics matter too: only rows that actually delivered are
 * deleted, so a transient outage leaves the queue intact rather than silently
 * abandoning orphans on the peer's side.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createDbMock } from '../test/db-mock'

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))

const sendFederationMessage = mock(
  async (_handle: string, _message: any) => true,
)
mock.module('./federation.service', () => ({ sendFederationMessage }))

let userHandle: string | null = 'alice@parchment.test'
const getUserHandle = mock(async (_userId: string) => userHandle)
mock.module('./user.service', () => ({ getUserHandle }))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
}))

const {
  listPendingRevocations,
  flushPendingRevocations,
  discardPendingRevocation,
} = await import('./revocations.service')

const item = (peerHandle: string) => ({
  peerHandle,
  signature: 'client-signature',
  nonce: 'nonce-1',
  timestamp: '2026-01-01T00:00:00.000Z',
})

beforeEach(() => {
  dbMock.reset()
  userHandle = 'alice@parchment.test'
  sendFederationMessage.mockClear()
  sendFederationMessage.mockImplementation(async () => true)
  getUserHandle.mockClear()
})

describe('listPendingRevocations', () => {
  test('returns the queued peers', async () => {
    dbMock.queueSelect([
      { id: 'p1', peerHandle: 'bob@peer.test', createdAt: new Date() },
    ])

    const rows = await listPendingRevocations('user-1')

    expect(rows).toHaveLength(1)
    expect(rows[0].peerHandle).toBe('bob@peer.test')
  })

  test('is empty in the normal case', async () => {
    dbMock.queueSelect([])

    expect(await listPendingRevocations('user-1')).toEqual([])
  })
})

describe('flushPendingRevocations — snapshot restriction', () => {
  test('delivers a revoke for a queued peer', async () => {
    dbMock.queueSelect([{ id: 'p1', peerHandle: 'bob@peer.test' }])

    const results = await flushPendingRevocations('user-1', [
      item('bob@peer.test'),
    ])

    expect(results).toEqual([{ peerHandle: 'bob@peer.test', delivered: true }])
    expect(sendFederationMessage).toHaveBeenCalled()
  })

  test('refuses a peer that was not in the snapshot', async () => {
    // Otherwise the endpoint would be a generic "send a revoke to anyone".
    dbMock.queueSelect([{ id: 'p1', peerHandle: 'bob@peer.test' }])

    const results = await flushPendingRevocations('user-1', [
      item('victim@elsewhere.test'),
    ])

    expect(results[0]).toEqual({
      peerHandle: 'victim@elsewhere.test',
      delivered: false,
      error: 'No pending revocation for this peer',
    })
    expect(sendFederationMessage).not.toHaveBeenCalled()
  })

  test('sends only the queued subset of a mixed batch', async () => {
    dbMock.queueSelect([{ id: 'p1', peerHandle: 'bob@peer.test' }])

    const results = await flushPendingRevocations('user-1', [
      item('bob@peer.test'),
      item('victim@elsewhere.test'),
    ])

    expect(sendFederationMessage).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.delivered)).toEqual([true, false])
  })

  test('fails every item when the user has no alias yet', async () => {
    userHandle = null

    const results = await flushPendingRevocations('user-1', [
      item('bob@peer.test'),
    ])

    expect(results[0].delivered).toBe(false)
    expect(results[0].error).toContain('No alias set')
    expect(sendFederationMessage).not.toHaveBeenCalled()
  })
})

describe('flushPendingRevocations — message shape', () => {
  beforeEach(() => {
    dbMock.queueSelect([{ id: 'p1', peerHandle: 'bob@peer.test' }])
  })

  test('forwards the client signature verbatim', async () => {
    await flushPendingRevocations('user-1', [item('bob@peer.test')])

    const message = sendFederationMessage.mock.calls[0][1] as any
    expect(message.signature).toBe('client-signature')
    expect(message.nonce).toBe('nonce-1')
    expect(message.timestamp).toBe('2026-01-01T00:00:00.000Z')
  })

  test('addresses the message from the user’s handle to the peer', async () => {
    await flushPendingRevocations('user-1', [item('bob@peer.test')])

    const message = sendFederationMessage.mock.calls[0][1] as any
    expect(message.from).toBe('alice@parchment.test')
    expect(message.to).toBe('bob@peer.test')
  })

  test('sends a v2 RELATIONSHIP_REVOKE', async () => {
    await flushPendingRevocations('user-1', [item('bob@peer.test')])

    const message = sendFederationMessage.mock.calls[0][1] as any
    expect(message.protocol_version).toBe(2)
    expect(message.message_type).toBe('RELATIONSHIP_REVOKE')
    expect(message.message_version).toBe(1)
  })

  test('honours an explicit message version', async () => {
    await flushPendingRevocations('user-1', [
      { ...item('bob@peer.test'), messageVersion: 2 },
    ])

    expect((sendFederationMessage.mock.calls[0][1] as any).message_version).toBe(2)
  })

  test('carries an empty payload — the envelope is the whole message', async () => {
    await flushPendingRevocations('user-1', [item('bob@peer.test')])

    expect((sendFederationMessage.mock.calls[0][1] as any).payload).toEqual({})
  })
})

describe('flushPendingRevocations — retry semantics', () => {
  test('deletes the row once delivery succeeds', async () => {
    dbMock.queueSelect([{ id: 'p1', peerHandle: 'bob@peer.test' }])

    await flushPendingRevocations('user-1', [item('bob@peer.test')])

    expect(dbMock.deleteCount).toBe(1)
  })

  test('keeps the row when the peer refuses the message', async () => {
    dbMock.queueSelect([{ id: 'p1', peerHandle: 'bob@peer.test' }])
    sendFederationMessage.mockResolvedValueOnce(false)

    const results = await flushPendingRevocations('user-1', [
      item('bob@peer.test'),
    ])

    expect(results[0]).toMatchObject({
      delivered: false,
      error: 'Peer server refused the message',
    })
    expect(dbMock.deleteCount).toBe(0)
  })

  test('keeps the row when delivery throws', async () => {
    dbMock.queueSelect([{ id: 'p1', peerHandle: 'bob@peer.test' }])
    sendFederationMessage.mockRejectedValueOnce(new Error('peer unreachable'))

    const results = await flushPendingRevocations('user-1', [
      item('bob@peer.test'),
    ])

    expect(results[0].delivered).toBe(false)
    expect(results[0].error).toBe('peer unreachable')
    expect(dbMock.deleteCount).toBe(0)
  })

  test('one failure does not stop the rest of the batch', async () => {
    dbMock.queueSelect([
      { id: 'p1', peerHandle: 'bob@peer.test' },
      { id: 'p2', peerHandle: 'carol@peer.test' },
    ])
    sendFederationMessage
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(true)

    const results = await flushPendingRevocations('user-1', [
      item('bob@peer.test'),
      item('carol@peer.test'),
    ])

    expect(results.map((r) => r.delivered)).toEqual([false, true])
    expect(dbMock.deleteCount).toBe(1)
  })

  test('an empty batch is a no-op', async () => {
    dbMock.queueSelect([])

    expect(await flushPendingRevocations('user-1', [])).toEqual([])
    expect(sendFederationMessage).not.toHaveBeenCalled()
  })
})

describe('discardPendingRevocation', () => {
  test('reports true when a row was dropped', async () => {
    dbMock.setReturningRows([{ id: 'p1' }])

    expect(
      await discardPendingRevocation('user-1', 'bob@peer.test'),
    ).toBe(true)
  })

  test('reports false when nothing matched', async () => {
    dbMock.setReturningRows([])

    expect(
      await discardPendingRevocation('user-1', 'nobody@peer.test'),
    ).toBe(false)
  })

  test('sends no federation message — the peer stays orphaned by design', async () => {
    dbMock.setReturningRows([{ id: 'p1' }])

    await discardPendingRevocation('user-1', 'bob@peer.test')

    expect(sendFederationMessage).not.toHaveBeenCalled()
  })
})
