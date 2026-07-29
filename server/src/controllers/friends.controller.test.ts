/**
 * Endpoint tests for the friends controller.
 *
 * Read and write routes sit behind different permissions (social:read vs
 * social:write), which is asserted per route below. The other recurring shape
 * is the service result envelope: `{ success: false, error }` becomes a 400
 * with the service's reason, falling back to a generic message when the
 * service supplies none.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import {
  authMockModule,
  setAuthUser,
  setHasPermission,
  resetAuth,
  TEST_USER,
} from '../test/auth-mock'
import { createTestApp, req } from '../test/app'

type ServiceResult = { success: boolean; error?: string; invitation?: unknown }

const ok = (extra: Partial<ServiceResult> = {}): ServiceResult => ({
  success: true,
  ...extra,
})

const sendFriendInvitation = mock(
  async (_userId: string, _handle: string, _signature: string) =>
    ok({ invitation: { id: 'inv-1' } }),
)
const acceptFriendInvitation = mock(
  async (_userId: string, _id: string, _signature: string) => ok(),
)
const rejectFriendInvitation = mock(
  async (_userId: string, _id: string, _signature?: string) => ok(),
)
const cancelFriendInvitation = mock(async (_userId: string, _id: string) => ok())
const getFriends = mock(async (_userId: string) => [{ handle: 'alice@peer.test' }])
const getInvitations = mock(
  async (_userId: string, _direction?: string) => [{ id: 'inv-1' }],
)
const removeFriend = mock(
  async (_userId: string, _handle: string, _sig?: string) => ok(),
)
const syncFriendKeys = mock(async (_userId: string) => [{ handle: 'alice@peer.test', updated: true }])

mock.module('../services/friends.service', () => ({
  sendFriendInvitation,
  acceptFriendInvitation,
  rejectFriendInvitation,
  cancelFriendInvitation,
  getFriends,
  getInvitations,
  removeFriend,
  syncFriendKeys,
}))

const resolveHandle = mock(
  async (_handle: string) =>
    ({ alias: 'alice', publicKey: 'pk' }) as unknown,
)
mock.module('../services/federation.service', () => ({ resolveHandle }))

// parseHandle is the real format check; keep it honest by only stubbing the
// crypto module's other exports.
const parseHandle = mock((handle: string) => {
  const match = /^([a-z0-9_.-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(handle)
  return match ? { alias: match[1], domain: match[2] } : null
})
mock.module('../lib/crypto', () => ({ parseHandle }))

mock.module('../middleware/auth.middleware', () => authMockModule())

const friends = (await import('./friends.controller')).default
const app = createTestApp(friends)

beforeEach(() => {
  resetAuth()
  sendFriendInvitation.mockClear()
  sendFriendInvitation.mockImplementation(async () => ok({ invitation: { id: 'inv-1' } }))
  acceptFriendInvitation.mockClear()
  acceptFriendInvitation.mockImplementation(async () => ok())
  rejectFriendInvitation.mockClear()
  rejectFriendInvitation.mockImplementation(async () => ok())
  cancelFriendInvitation.mockClear()
  cancelFriendInvitation.mockImplementation(async () => ok())
  getFriends.mockClear()
  getInvitations.mockClear()
  removeFriend.mockClear()
  removeFriend.mockImplementation(async () => ok())
  syncFriendKeys.mockClear()
  resolveHandle.mockClear()
  resolveHandle.mockImplementation(async () => ({ alias: 'alice', publicKey: 'pk' }))
  parseHandle.mockClear()
})

describe('permission gating', () => {
  const readRoutes = [
    ['get', '/friends'],
    ['get', '/friends/invitations'],
    ['get', '/friends/resolve/alice@peer.test'],
  ] as const

  const writeRoutes = [
    ['post', '/friends/invite'],
    ['post', '/friends/invitations/inv-1/accept'],
    ['post', '/friends/invitations/inv-1/reject'],
    ['delete', '/friends/invitations/inv-1'],
    ['delete', '/friends/alice@peer.test'],
    ['post', '/friends/sync-keys'],
  ] as const

  for (const [method, path] of [...readRoutes, ...writeRoutes]) {
    test(`${method.toUpperCase()} ${path} rejects an unauthenticated caller`, async () => {
      setAuthUser(null)

      const res = await req(app)[method](path, {
        body: { handle: 'alice@peer.test', signature: 'sig' },
      })

      expect(res.status).toBe(401)
    })

    test(`${method.toUpperCase()} ${path} rejects a caller without the permission`, async () => {
      setHasPermission(false)

      const res = await req(app)[method](path, {
        body: { handle: 'alice@peer.test', signature: 'sig' },
      })

      expect(res.status).toBe(403)
    })
  }
})

describe('GET /friends', () => {
  test('lists the caller’s accepted friends', async () => {
    const res = await req(app).get('/friends')

    expect(res.status).toBe(200)
    expect(getFriends).toHaveBeenCalledWith(TEST_USER.id)
    expect(res.body.friends).toHaveLength(1)
  })
})

describe('GET /friends/invitations', () => {
  test('returns pending invitations in both directions by default', async () => {
    const res = await req(app).get('/friends/invitations')

    expect(res.status).toBe(200)
    expect(getInvitations).toHaveBeenCalledWith(TEST_USER.id, undefined)
  })

  for (const direction of ['incoming', 'outgoing'] as const) {
    test(`filters to ${direction} invitations`, async () => {
      await req(app).get('/friends/invitations', { query: { direction } })

      expect(getInvitations).toHaveBeenCalledWith(TEST_USER.id, direction)
    })
  }

  test('422s on an unknown direction', async () => {
    const res = await req(app).get('/friends/invitations', {
      query: { direction: 'sideways' },
    })

    expect(res.status).toBe(422)
    expect(getInvitations).not.toHaveBeenCalled()
  })
})

describe('POST /friends/invite', () => {
  test('sends an invitation for a well-formed handle', async () => {
    const res = await req(app).post('/friends/invite', {
      body: { handle: 'alice@peer.test', signature: 'sig' },
    })

    expect(res.status).toBe(200)
    expect(sendFriendInvitation).toHaveBeenCalledWith(
      TEST_USER.id,
      'alice@peer.test',
      'sig',
    )
    expect(res.body.invitation).toEqual({ id: 'inv-1' })
  })

  test('400s on a malformed handle before reaching the service', async () => {
    const res = await req(app).post('/friends/invite', {
      body: { handle: 'not-a-handle', signature: 'sig' },
    })

    expect(res.status).toBe(400)
    expect(sendFriendInvitation).not.toHaveBeenCalled()
  })

  test('surfaces the service’s reason on failure', async () => {
    sendFriendInvitation.mockResolvedValueOnce({
      success: false,
      error: 'Already friends',
    })

    const res = await req(app).post('/friends/invite', {
      body: { handle: 'alice@peer.test', signature: 'sig' },
    })

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Already friends')
  })

  test('falls back to a generic message when the service gives no reason', async () => {
    sendFriendInvitation.mockResolvedValueOnce({ success: false })

    const res = await req(app).post('/friends/invite', {
      body: { handle: 'alice@peer.test', signature: 'sig' },
    })

    expect(res.body.message).toBe('Failed to send invitation')
  })

  test('422s without a signature', async () => {
    const res = await req(app).post('/friends/invite', {
      body: { handle: 'alice@peer.test' },
    })

    expect(res.status).toBe(422)
    expect(sendFriendInvitation).not.toHaveBeenCalled()
  })
})

describe('invitation lifecycle', () => {
  test('accept passes the caller’s signature through', async () => {
    const res = await req(app).post('/friends/invitations/inv-1/accept', {
      body: { signature: 'accept-sig' },
    })

    expect(res.status).toBe(200)
    expect(acceptFriendInvitation).toHaveBeenCalledWith(
      TEST_USER.id,
      'inv-1',
      'accept-sig',
    )
  })

  test('accept 422s without a signature', async () => {
    const res = await req(app).post('/friends/invitations/inv-1/accept', { body: {} })

    expect(res.status).toBe(422)
    expect(acceptFriendInvitation).not.toHaveBeenCalled()
  })

  test('accept surfaces the service failure', async () => {
    acceptFriendInvitation.mockResolvedValueOnce({
      success: false,
      error: 'Invitation expired',
    })

    const res = await req(app).post('/friends/invitations/inv-1/accept', {
      body: { signature: 'sig' },
    })

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invitation expired')
  })

  test('reject works with an optional signature', async () => {
    const res = await req(app).post('/friends/invitations/inv-1/reject', {
      body: { signature: 'reject-sig' },
    })

    expect(res.status).toBe(200)
    expect(rejectFriendInvitation).toHaveBeenCalledWith(
      TEST_USER.id,
      'inv-1',
      'reject-sig',
    )
  })

  test('reject works with no body at all', async () => {
    const res = await req(app).post('/friends/invitations/inv-1/reject')

    expect(res.status).toBe(200)
    expect(rejectFriendInvitation).toHaveBeenCalled()
  })

  test('cancel removes an outgoing invitation', async () => {
    const res = await req(app).delete('/friends/invitations/inv-1')

    expect(res.status).toBe(200)
    expect(cancelFriendInvitation).toHaveBeenCalledWith(TEST_USER.id, 'inv-1')
  })

  test('cancel surfaces the service failure', async () => {
    cancelFriendInvitation.mockResolvedValueOnce({
      success: false,
      error: 'Not your invitation',
    })

    const res = await req(app).delete('/friends/invitations/inv-1')

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Not your invitation')
  })
})

describe('DELETE /friends/:handle', () => {
  test('removes the friend', async () => {
    const res = await req(app).delete('/friends/alice@peer.test')

    expect(res.status).toBe(200)
    expect(removeFriend).toHaveBeenCalledWith(
      TEST_USER.id,
      'alice@peer.test',
      undefined,
    )
  })

  test('decodes a percent-encoded handle', async () => {
    await req(app).delete('/friends/alice%40peer.test')

    expect(removeFriend.mock.calls[0][1]).toBe('alice@peer.test')
  })

  test('forwards the revocation signature when supplied', async () => {
    await req(app).delete('/friends/alice@peer.test', {
      query: { revoke_signature: 'revoke-sig' },
    })

    expect(removeFriend.mock.calls[0][2]).toBe('revoke-sig')
  })

  test('surfaces the service failure', async () => {
    removeFriend.mockResolvedValueOnce({ success: false, error: 'Not a friend' })

    const res = await req(app).delete('/friends/alice@peer.test')

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Not a friend')
  })
})

describe('GET /friends/resolve/:handle', () => {
  test('resolves a remote handle', async () => {
    const res = await req(app).get('/friends/resolve/alice@peer.test')

    expect(res.status).toBe(200)
    expect(resolveHandle).toHaveBeenCalledWith('alice@peer.test')
    expect(res.body.alias).toBe('alice')
  })

  test('decodes a percent-encoded handle', async () => {
    await req(app).get('/friends/resolve/alice%40peer.test')

    expect(resolveHandle).toHaveBeenCalledWith('alice@peer.test')
  })

  test('400s on a malformed handle without a federation lookup', async () => {
    const res = await req(app).get('/friends/resolve/garbage')

    expect(res.status).toBe(400)
    expect(resolveHandle).not.toHaveBeenCalled()
  })

  test('404s when the handle resolves to nothing', async () => {
    resolveHandle.mockResolvedValueOnce(null)

    const res = await req(app).get('/friends/resolve/nobody@peer.test')

    expect(res.status).toBe(404)
  })
})

describe('POST /friends/sync-keys', () => {
  test('re-syncs friend keys for the caller', async () => {
    const res = await req(app).post('/friends/sync-keys')

    expect(res.status).toBe(200)
    expect(syncFriendKeys).toHaveBeenCalledWith(TEST_USER.id)
    expect(res.body.results).toHaveLength(1)
  })
})
