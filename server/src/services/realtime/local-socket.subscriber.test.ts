/**
 * Unit tests for the local-socket subscriber.
 *
 * This is the subscriber that actually makes in-browser realtime work, so the
 * two things worth pinning are the wire frame and the failure path.
 *
 * The frame is built ONCE and the same string is sent to every socket — both
 * for cost (one serialization per event, not per connection) and so every tab
 * observes byte-identical data. It deliberately carries only id/event/
 * timestamp/payload: the recipient list must never reach a client, since it
 * would disclose who else received the event.
 *
 * A failed `send` means the socket is dead or backpressured. The subscriber
 * drops it from the registry rather than retrying, so a single broken
 * connection can't stall or repeatedly fail every subsequent publish — and,
 * critically, must not stop the remaining recipients from being served.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'

const socketsForUser = mock((_userId: string) => [] as any[])
const removeById = mock((_id: string) => {})

mock.module('./registry.service', () => ({ socketsForUser, removeById }))
mock.module('../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
}))

const { localSocketSubscriber } = await import('./local-socket.subscriber')

const event = {
  id: 'evt-1',
  event: 'collection:updated',
  timestamp: '2026-01-01T00:00:00.000Z',
  payload: { id: 'c-1', name: 'Trips' },
}

/** A connection that records what it was sent. */
function connection(id: string, onSend?: () => void) {
  const sent: string[] = []
  return {
    id,
    sent,
    closed: [] as unknown[],
    send(frame: string) {
      onSend?.()
      sent.push(frame)
    },
    close(code: number, reason: string) {
      this.closed.push([code, reason])
    },
  }
}

beforeEach(() => {
  socketsForUser.mockReset()
  socketsForUser.mockReturnValue([])
  removeById.mockClear()
})

describe('dispatch', () => {
  test('sends one frame to each of a user’s sockets', () => {
    const a = connection('conn-a')
    const b = connection('conn-b')
    socketsForUser.mockReturnValue([a, b])

    localSocketSubscriber.deliver(event as any, {
      localUserIds: ['u-1'],
      remoteHandles: [],
    })

    expect(a.sent).toHaveLength(1)
    expect(b.sent).toHaveLength(1)
  })

  test('serializes the frame once and reuses it', () => {
    // Identical bytes for every recipient.
    const a = connection('conn-a')
    const b = connection('conn-b')
    socketsForUser.mockReturnValue([a, b])

    localSocketSubscriber.deliver(event as any, {
      localUserIds: ['u-1'],
      remoteHandles: [],
    })

    expect(a.sent[0]).toBe(b.sent[0])
  })

  test('carries only the client-facing fields', () => {
    // The recipient list must never leak to a connected tab.
    const conn = connection('conn-a')
    socketsForUser.mockReturnValue([conn])

    localSocketSubscriber.deliver(event as any, {
      localUserIds: ['u-1', 'u-2'],
      remoteHandles: ['someone@peer.test'],
    })

    const frame = JSON.parse(conn.sent[0])
    expect(frame).toEqual({
      id: 'evt-1',
      event: 'collection:updated',
      timestamp: '2026-01-01T00:00:00.000Z',
      payload: { id: 'c-1', name: 'Trips' },
    })
  })

  test('looks up every local recipient', () => {
    localSocketSubscriber.deliver(event as any, {
      localUserIds: ['u-1', 'u-2'],
      remoteHandles: [],
    })

    expect(socketsForUser.mock.calls.map((c) => c[0])).toEqual(['u-1', 'u-2'])
  })

  test('does nothing when there are no local recipients', () => {
    // A purely remote event is the federation subscriber's job.
    localSocketSubscriber.deliver(event as any, {
      localUserIds: [],
      remoteHandles: ['someone@peer.test'],
    })

    expect(socketsForUser).not.toHaveBeenCalled()
  })

  test('tolerates a recipient with no open connections', () => {
    socketsForUser.mockReturnValue([])

    expect(() =>
      localSocketSubscriber.deliver(event as any, {
        localUserIds: ['u-1'],
        remoteHandles: [],
      }),
    ).not.toThrow()
    expect(removeById).not.toHaveBeenCalled()
  })

  test('identifies itself for registration', () => {
    expect(localSocketSubscriber.name).toBe('local-socket')
  })
})

describe('failed sends', () => {
  const failing = (id: string) =>
    connection(id, () => {
      throw new Error('backpressure')
    })

  test('drops a socket that fails to send', () => {
    socketsForUser.mockReturnValue([failing('conn-dead')])

    localSocketSubscriber.deliver(event as any, {
      localUserIds: ['u-1'],
      remoteHandles: [],
    })

    expect(removeById).toHaveBeenCalledWith('conn-dead')
  })

  test('closes the dead socket with an internal-error code', () => {
    const dead = failing('conn-dead')
    socketsForUser.mockReturnValue([dead])

    localSocketSubscriber.deliver(event as any, {
      localUserIds: ['u-1'],
      remoteHandles: [],
    })

    expect(dead.closed).toEqual([[1011, 'Send failed']])
  })

  test('keeps serving the remaining sockets', () => {
    // One broken tab must not silence the user's other tabs.
    const healthy = connection('conn-ok')
    socketsForUser.mockReturnValue([failing('conn-dead'), healthy])

    localSocketSubscriber.deliver(event as any, {
      localUserIds: ['u-1'],
      remoteHandles: [],
    })

    expect(healthy.sent).toHaveLength(1)
  })

  test('keeps serving the remaining recipients', () => {
    const healthy = connection('conn-ok')
    socketsForUser
      .mockReturnValueOnce([failing('conn-dead')])
      .mockReturnValueOnce([healthy])

    localSocketSubscriber.deliver(event as any, {
      localUserIds: ['u-1', 'u-2'],
      remoteHandles: [],
    })

    expect(healthy.sent).toHaveLength(1)
  })

  test('still deregisters when close() itself throws', () => {
    // An already-dead socket can throw from close(); the registry cleanup
    // has to happen anyway or the reference leaks forever.
    const dead = {
      id: 'conn-dead',
      send() {
        throw new Error('backpressure')
      },
      close() {
        throw new Error('already closed')
      },
    }
    socketsForUser.mockReturnValue([dead])

    expect(() =>
      localSocketSubscriber.deliver(event as any, {
        localUserIds: ['u-1'],
        remoteHandles: [],
      }),
    ).not.toThrow()
    expect(removeById).toHaveBeenCalledWith('conn-dead')
  })

  test('handles a connection with no close method', () => {
    const dead = {
      id: 'conn-dead',
      send() {
        throw new Error('backpressure')
      },
    }
    socketsForUser.mockReturnValue([dead])

    expect(() =>
      localSocketSubscriber.deliver(event as any, {
        localUserIds: ['u-1'],
        remoteHandles: [],
      }),
    ).not.toThrow()
    expect(removeById).toHaveBeenCalledWith('conn-dead')
  })
})
