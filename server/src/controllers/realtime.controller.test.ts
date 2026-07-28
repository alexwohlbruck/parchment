/**
 * Endpoint tests for the realtime controller's HTTP surface.
 *
 * Only the ticket-mint and stats routes are driven here — the WS route can't
 * be exercised through `app.handle()` without a real upgrade. What this file
 * does pin down is the split the controller deliberately makes: the HTTP
 * routes require a session, while the WS route sits on a second Elysia
 * instance precisely so it does NOT inherit `requireAuth` (browsers can't set
 * an Authorization header on a WS handshake — the ticket is the auth step).
 * A regression that merged the two instances would show up as the WS route
 * 401ing, which the last test guards against.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { authMockModule, setAuthUser, resetAuth, TEST_USER } from '../test/auth-mock'
import { createTestApp, req } from '../test/app'

const mintTicket = mock((_userId: string) => ({
  ticket: 'tkt_abc',
  expiresAt: '2026-01-01T00:00:30.000Z',
}))
const redeemTicket = mock((_ticket: string) => 'user-1' as string | null)

mock.module('../services/realtime/ticket.service', () => ({ mintTicket, redeemTicket }))

const connectedUserCount = mock(() => 3)
const totalSocketCount = mock(() => 7)

mock.module('../services/realtime/registry.service', () => ({
  add: mock(() => undefined),
  removeById: mock(() => undefined),
  connectedUserCount,
  totalSocketCount,
}))

mock.module('../services/transit/transit-poller.service', () => ({
  subscribe: mock(() => undefined),
  unsubscribe: mock(() => undefined),
  updateBounds: mock(() => undefined),
  onConnectionClosed: mock(() => undefined),
}))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
}))

mock.module('../middleware/auth.middleware', () => authMockModule())

const realtime = (await import('./realtime.controller')).default
const app = createTestApp(realtime)

beforeEach(() => {
  resetAuth()
  mintTicket.mockClear()
  redeemTicket.mockClear()
  connectedUserCount.mockClear()
  totalSocketCount.mockClear()
})

describe('POST /realtime/ticket', () => {
  test('mints a ticket for the calling user', async () => {
    const res = await req(app).post('/realtime/ticket')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      ticket: 'tkt_abc',
      expiresAt: '2026-01-01T00:00:30.000Z',
    })
    expect(mintTicket).toHaveBeenCalledWith(TEST_USER.id)
  })

  test('rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).post('/realtime/ticket')

    expect(res.status).toBe(401)
    expect(mintTicket).not.toHaveBeenCalled()
  })

  test('mints against the session identity, not a client-supplied id', async () => {
    setAuthUser({ ...TEST_USER, id: 'other-user' })

    await req(app).post('/realtime/ticket', { body: { userId: 'victim' } as any })

    expect(mintTicket).toHaveBeenCalledWith('other-user')
  })
})

describe('GET /realtime/stats', () => {
  test('returns the connection counters', async () => {
    const res = await req(app).get('/realtime/stats')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ connectedUsers: 3, totalSockets: 7 })
  })

  test('is gated so anonymous scrapers can’t read connection state', async () => {
    setAuthUser(null)

    const res = await req(app).get('/realtime/stats')

    expect(res.status).toBe(401)
    expect(connectedUserCount).not.toHaveBeenCalled()
  })
})

describe('WS route instance separation', () => {
  test('the WS path does not answer 401 for an anonymous request', async () => {
    // The WS route lives on an instance without `requireAuth`. If it were ever
    // merged onto the HTTP instance it would inherit the guard and every
    // browser upgrade would fail, since a handshake carries no Authorization
    // header. Anything but 401 means the separation still holds.
    setAuthUser(null)

    const res = await req(app).get('/realtime', { query: { ticket: 'tkt_abc' } })

    expect(res.status).not.toBe(401)
  })
})
