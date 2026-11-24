import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createDbMock } from '../../test/db-mock'

const dbMock = createDbMock()
mock.module('../../db', () => ({ db: dbMock.db }))

const registry = await import('./registry.service')
const { closeExpiredSessionSockets } = await import('./session-watchdog.service')

function connect(userId: string, id: string, sessionId: string) {
  const close = mock((_code?: number, _reason?: string) => undefined)
  registry.add(userId, { id, sessionId, send: () => undefined, close })
  return close
}

beforeEach(() => {
  dbMock.reset()
  registry._resetForTests()
})

describe('closeExpiredSessionSockets', () => {
  test('closes sockets whose session is no longer live', async () => {
    const liveClose = connect('u1', 'c1', 's-live')
    const expiredClose = connect('u1', 'c2', 's-expired')
    dbMock.queueSelect([{ id: 's-live' }])

    expect(await closeExpiredSessionSockets()).toBe(1)
    expect(expiredClose).toHaveBeenCalled()
    expect(liveClose).not.toHaveBeenCalled()
    expect(registry.totalSocketCount()).toBe(1)
  })

  test('skips the query with no open sockets', async () => {
    expect(await closeExpiredSessionSockets()).toBe(0)
  })
})
