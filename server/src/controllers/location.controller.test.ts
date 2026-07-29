/**
 * Endpoint tests for the E2EE location controller.
 *
 * The broadcast route carries the security-critical rule: a ciphertext row is
 * stored only when the recipient is an accepted friend AND the caller has
 * explicitly enabled sharing with them. Without both gates an authenticated
 * user could fan rows out to arbitrary handles and use realtime delivery as a
 * presence oracle, so each gate is asserted independently below — including
 * that a rejected item never reaches the store.
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

const isFriend = mock(async (_userId: string, _handle: string) => true)

const getLocationSharingConfigs = mock(async (_userId: string) => [
  { friendHandle: 'alice@peer.test', enabled: true },
])
const setLocationSharingConfig = mock(
  async (_userId: string, handle: string, patch: { enabled?: boolean }) => ({
    friendHandle: handle,
    enabled: patch.enabled ?? false,
  }),
)
const disableLocationSharing = mock(async (_userId: string, _handle: string) => true)
const getLocationSharingConfigForFriend = mock(
  async (_userId: string, _handle: string) =>
    ({ enabled: true }) as { enabled: boolean } | null,
)
const storeEncryptedLocation = mock(
  async (_userId: string, _handle: string, _cipher: string, _nonce: string) => ({
    stored: true,
  }),
)
const getEncryptedLocationsFromFriends = mock(async (_userId: string) => [
  {
    id: 'loc-1',
    userId: 'friend-1',
    senderHandle: 'alice@peer.test',
    encryptedLocation: 'cipher',
    nonce: 'nonce',
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  },
])

mock.module('../services/friends.service', () => ({ isFriend }))
mock.module('../services/location-e2ee.service', () => ({
  getLocationSharingConfigs,
  setLocationSharingConfig,
  disableLocationSharing,
  getLocationSharingConfigForFriend,
  storeEncryptedLocation,
  getEncryptedLocationsFromFriends,
}))
mock.module('../middleware/auth.middleware', () => authMockModule())

const location = (await import('./location.controller')).default
const app = createTestApp(location)

const broadcast = (handle: string) => ({
  forFriendHandle: handle,
  encryptedLocation: 'cipher',
  nonce: 'nonce-1',
})

beforeEach(() => {
  resetAuth()
  isFriend.mockClear()
  isFriend.mockImplementation(async () => true)
  getLocationSharingConfigs.mockClear()
  setLocationSharingConfig.mockClear()
  disableLocationSharing.mockClear()
  getLocationSharingConfigForFriend.mockClear()
  getLocationSharingConfigForFriend.mockImplementation(async () => ({ enabled: true }))
  storeEncryptedLocation.mockClear()
  storeEncryptedLocation.mockImplementation(async () => ({ stored: true }))
  getEncryptedLocationsFromFriends.mockClear()
})

describe('gating', () => {
  const routes = [
    ['get', '/location/e2ee/config'],
    ['post', '/location/e2ee/config'],
    ['delete', '/location/e2ee/config/alice@peer.test'],
    ['post', '/location/e2ee/update'],
    ['get', '/location/e2ee/friends'],
  ] as const

  for (const [method, path] of routes) {
    test(`${method.toUpperCase()} ${path} rejects an unauthenticated caller`, async () => {
      setAuthUser(null)

      const res = await req(app)[method](path, {
        body: { friendHandle: 'a@b.test', locations: [] },
      })

      expect(res.status).toBe(401)
    })

    test(`${method.toUpperCase()} ${path} rejects a caller without location:sharing`, async () => {
      setHasPermission(false)

      const res = await req(app)[method](path, {
        body: { friendHandle: 'a@b.test', locations: [] },
      })

      expect(res.status).toBe(403)
    })
  }
})

describe('GET /location/e2ee/config', () => {
  test('returns the caller’s sharing configuration', async () => {
    const res = await req(app).get('/location/e2ee/config')

    expect(res.status).toBe(200)
    expect(getLocationSharingConfigs).toHaveBeenCalledWith(TEST_USER.id)
    expect(res.body.configs).toHaveLength(1)
  })
})

describe('POST /location/e2ee/config', () => {
  test('enables sharing with a friend', async () => {
    const res = await req(app).post('/location/e2ee/config', {
      body: { friendHandle: 'alice@peer.test', enabled: true },
    })

    expect(res.status).toBe(200)
    expect(setLocationSharingConfig).toHaveBeenCalledWith(
      TEST_USER.id,
      'alice@peer.test',
      { enabled: true },
    )
  })

  test('normalizes the handle to lowercase', async () => {
    await req(app).post('/location/e2ee/config', {
      body: { friendHandle: 'Alice@Peer.TEST', enabled: true },
    })

    expect(setLocationSharingConfig.mock.calls[0][1]).toBe('alice@peer.test')
  })

  test('422s without a friend handle', async () => {
    const res = await req(app).post('/location/e2ee/config', {
      body: { enabled: true },
    })

    expect(res.status).toBe(422)
    expect(setLocationSharingConfig).not.toHaveBeenCalled()
  })
})

describe('DELETE /location/e2ee/config/:friendHandle', () => {
  test('disables sharing and reports whether a row was removed', async () => {
    const res = await req(app).delete('/location/e2ee/config/alice@peer.test')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ deleted: true })
    expect(disableLocationSharing).toHaveBeenCalledWith(
      TEST_USER.id,
      'alice@peer.test',
    )
  })

  test('decodes a percent-encoded handle before matching', async () => {
    await req(app).delete('/location/e2ee/config/alice%40peer.test')

    expect(disableLocationSharing.mock.calls[0][1]).toBe('alice@peer.test')
  })

  test('lowercases the handle', async () => {
    await req(app).delete('/location/e2ee/config/ALICE%40PEER.TEST')

    expect(disableLocationSharing.mock.calls[0][1]).toBe('alice@peer.test')
  })
})

describe('POST /location/e2ee/update — authorization gates', () => {
  test('stores a location for an enabled friend', async () => {
    const res = await req(app).post('/location/e2ee/update', {
      body: { locations: [broadcast('alice@peer.test')] },
    })

    expect(res.status).toBe(200)
    expect(res.body.results).toEqual([
      { friendHandle: 'alice@peer.test', stored: true },
    ])
    expect(storeEncryptedLocation).toHaveBeenCalledWith(
      TEST_USER.id,
      'alice@peer.test',
      'cipher',
      'nonce-1',
    )
  })

  test('refuses to store for a handle that is not a friend', async () => {
    isFriend.mockResolvedValueOnce(false)

    const res = await req(app).post('/location/e2ee/update', {
      body: { locations: [broadcast('stranger@peer.test')] },
    })

    expect(res.body.results[0]).toEqual({
      friendHandle: 'stranger@peer.test',
      stored: false,
      reason: 'not-a-friend',
    })
    expect(storeEncryptedLocation).not.toHaveBeenCalled()
  })

  test('refuses to store when the caller has not enabled sharing', async () => {
    getLocationSharingConfigForFriend.mockResolvedValueOnce({ enabled: false })

    const res = await req(app).post('/location/e2ee/update', {
      body: { locations: [broadcast('alice@peer.test')] },
    })

    expect(res.body.results[0].reason).toBe('not-enabled')
    expect(storeEncryptedLocation).not.toHaveBeenCalled()
  })

  test('refuses to store when no sharing config exists at all', async () => {
    getLocationSharingConfigForFriend.mockResolvedValueOnce(null)

    const res = await req(app).post('/location/e2ee/update', {
      body: { locations: [broadcast('alice@peer.test')] },
    })

    expect(res.body.results[0].reason).toBe('not-enabled')
    expect(storeEncryptedLocation).not.toHaveBeenCalled()
  })

  test('reports a replayed nonce without storing', async () => {
    storeEncryptedLocation.mockResolvedValueOnce({ stored: false })

    const res = await req(app).post('/location/e2ee/update', {
      body: { locations: [broadcast('alice@peer.test')] },
    })

    expect(res.body.results[0].reason).toBe('replayed')
  })

  test('lowercases the recipient handle before the friendship check', async () => {
    await req(app).post('/location/e2ee/update', {
      body: { locations: [broadcast('ALICE@PEER.TEST')] },
    })

    expect(isFriend.mock.calls[0][1]).toBe('alice@peer.test')
  })
})

describe('POST /location/e2ee/update — batch behaviour', () => {
  test('processes each item independently', async () => {
    isFriend.mockImplementation(async (_id, handle) => handle === 'alice@peer.test')

    const res = await req(app).post('/location/e2ee/update', {
      body: {
        locations: [
          broadcast('alice@peer.test'),
          broadcast('stranger@peer.test'),
          broadcast('alice@peer.test'),
        ],
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.results.map((r: any) => r.stored)).toEqual([true, false, true])
  })

  test('a thrown error on one item does not fail the batch', async () => {
    storeEncryptedLocation
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ stored: true })

    const res = await req(app).post('/location/e2ee/update', {
      body: { locations: [broadcast('alice@peer.test'), broadcast('bob@peer.test')] },
    })

    expect(res.status).toBe(200)
    expect(res.body.results[0]).toEqual({
      friendHandle: 'alice@peer.test',
      stored: false,
      reason: 'error',
    })
    expect(res.body.results[1].stored).toBe(true)
  })

  test('accepts an empty batch', async () => {
    const res = await req(app).post('/location/e2ee/update', {
      body: { locations: [] },
    })

    expect(res.status).toBe(200)
    expect(res.body.results).toEqual([])
  })

  test('422s when an item is missing its nonce', async () => {
    const res = await req(app).post('/location/e2ee/update', {
      body: {
        locations: [{ forFriendHandle: 'alice@peer.test', encryptedLocation: 'c' }],
      },
    })

    expect(res.status).toBe(422)
    expect(storeEncryptedLocation).not.toHaveBeenCalled()
  })
})

describe('POST /location/e2ee/update — rate limiting', () => {
  test('429s past 60 broadcasts a minute', async () => {
    setAuthUser({ ...TEST_USER, id: 'broadcast-flood' })

    let last = { status: 200 } as { status: number }
    for (let i = 0; i < 61; i++) {
      last = await req(app).post('/location/e2ee/update', {
        body: { locations: [] },
      })
    }

    expect(last.status).toBe(429)
  })
})

describe('GET /location/e2ee/friends', () => {
  test('returns friends’ ciphertext with ISO timestamps', async () => {
    const res = await req(app).get('/location/e2ee/friends')

    expect(res.status).toBe(200)
    expect(res.body.locations[0]).toEqual({
      id: 'loc-1',
      fromUserId: 'friend-1',
      senderHandle: 'alice@peer.test',
      encryptedLocation: 'cipher',
      nonce: 'nonce',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  test('returns an empty list when no friend is sharing', async () => {
    getEncryptedLocationsFromFriends.mockResolvedValueOnce([])

    const res = await req(app).get('/location/e2ee/friends')

    expect(res.body.locations).toEqual([])
  })
})
