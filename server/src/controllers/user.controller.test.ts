/**
 * Endpoint tests for the user controller.
 *
 * The privilege-escalation guard on invite is the headline: a caller without
 * USERS_UPDATE may only grant the default 'user' role plus roles they already
 * hold, so an alpha tester can invite other alpha testers but nobody can mint
 * an account above their own level.
 *
 * Also pinned: duplicate emails surface as 409 rather than a 500 from the
 * Postgres unique violation, impersonation is refused outright in production,
 * key rotation reports a lost CAS race as 409 (nothing written), and the
 * identity reset needs its literal confirmation string.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import {
  authMockModule,
  setAuthUser,
  setHasPermission,
  resetAuth,
  TEST_USER,
} from '../test/auth-mock'
import { createDbMock } from '../test/db-mock'
import { createTestApp, req } from '../test/app'
import { PermissionId } from '../types/auth.types'

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))

let permissions: string[] = []
let callerRoles: { id: string }[] = [{ id: 'user' }]

const getPermissions = mock(async (_userId: string) => permissions)
const getRoles = mock(async (_userId: string) => callerRoles)
const hasPermission = mock((perms: string[], required: string) =>
  perms.includes(required),
)
mock.module('../services/auth.service', () => ({
  getPermissions,
  getRoles,
  hasPermission,
}))

const createSession = mock(async (userId: string, _attrs: unknown) => ({
  id: `session-${userId}`,
}))
mock.module('../lucia', () => ({ lucia: { createSession } }))

const sendMail = mock(async (_opts: unknown) => undefined)
mock.module('../services/mailer.service', () => ({ sendMail }))

const updateUserAlias = mock(
  async (_userId: string, _alias: string) =>
    ({ success: true }) as { success: boolean; error?: string },
)
const updateUserKeys = mock(
  async (_userId: string, _signing: string, _encryption: string) => undefined,
)
const getUserIdentity = mock(async (_userId: string) => ({
  alias: 'testuser',
  handle: 'testuser@parchment.test',
}))
const updateUserDisplayProfile = mock(async (_userId: string, _patch: any) => ({
  id: TEST_USER.id,
  firstName: 'New',
}))
mock.module('../services/user.service', () => ({
  updateUserAlias,
  updateUserKeys,
  getUserIdentity,
  updateUserDisplayProfile,
}))

const emitUserProfile = mock(async (..._args: unknown[]) => undefined)
mock.module('../services/realtime/emit', () => ({
  emit: { userProfile: emitUserProfile },
}))

const resetUserIdentity = mock(async (_userId: string) => undefined)
mock.module('../services/identity-reset.service', () => ({ resetUserIdentity }))

class RotationConflict extends Error {}
const getUserKmVersion = mock(
  async (_userId: string) => 3 as number | null,
)
const commitRotation = mock(async (_input: any) => 4)
mock.module('../services/km-rotation.service', () => ({
  getUserKmVersion,
  commitRotation,
  RotationConflict,
}))

const getOrCreateUserPreferences = mock(async (_userId: string) => ({
  language: 'en-US',
  unitSystem: 'metric',
}))
const updateUserPreferences = mock(async (_userId: string, updates: any) => ({
  language: updates.language ?? 'en-US',
  unitSystem: updates.unitSystem ?? 'metric',
}))
mock.module('../services/user-preferences.service', () => ({
  getOrCreateUserPreferences,
  updateUserPreferences,
}))

const createInitialCollection = mock(async (_userId: string) => undefined)
mock.module('../services/library/collections.service', () => ({
  createInitialCollection,
}))

const listPendingRevocations = mock(async (_userId: string) => ['peer@other.test'])
const flushPendingRevocations = mock(
  async (_userId: string, _items: unknown[]) => ({ sent: 1 }),
)
const discardPendingRevocation = mock(
  async (_userId: string, _handle: string) => true,
)
mock.module('../services/revocations.service', () => ({
  listPendingRevocations,
  flushPendingRevocations,
  discardPendingRevocation,
}))

mock.module('../services/federation.service', () => ({
  buildHandle: (alias: string) => `${alias}@parchment.test`,
  getServerDomain: () => 'parchment.test',
}))

mock.module('../lib/crypto', () => ({
  isValidAlias: (alias: string) => /^[a-zA-Z0-9_]{3,30}$/.test(alias),
}))

mock.module('../services/subscription.service', () => ({
  getAdminUserSubscriptionInfo: mock(async () => ({ tier: 'free' })),
}))

mock.module('../config', () => ({ billing: { enabled: true } }))
mock.module('../config/origins.config', () => ({
  clientOrigin: 'https://app.parchment.test',
}))
mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
}))
mock.module('../util', () => ({ generateId: () => 'new-user-id' }))
mock.module('../middleware/auth.middleware', () => authMockModule())

const userController = (await import('./user.controller')).default
const app = createTestApp(userController)

beforeEach(() => {
  resetAuth()
  dbMock.reset()
  permissions = [PermissionId.USERS_UPDATE]
  callerRoles = [{ id: 'user' }]
  getPermissions.mockClear()
  getRoles.mockClear()
  createSession.mockClear()
  sendMail.mockClear()
  updateUserAlias.mockClear()
  updateUserAlias.mockImplementation(async () => ({ success: true }))
  updateUserKeys.mockClear()
  getUserIdentity.mockClear()
  updateUserDisplayProfile.mockClear()
  emitUserProfile.mockClear()
  resetUserIdentity.mockClear()
  getUserKmVersion.mockClear()
  getUserKmVersion.mockImplementation(async () => 3)
  commitRotation.mockClear()
  commitRotation.mockImplementation(async () => 4)
  getOrCreateUserPreferences.mockClear()
  updateUserPreferences.mockClear()
  createInitialCollection.mockClear()
  listPendingRevocations.mockClear()
  flushPendingRevocations.mockClear()
  discardPendingRevocation.mockClear()
})

describe('POST /users — invite privilege escalation guard', () => {
  const invite = { email: 'invitee@parchment.test' }

  test('an admin with USERS_UPDATE may grant any role', async () => {
    permissions = [PermissionId.USERS_UPDATE]
    dbMock.queueSelect([{ id: 'admin' }])
    dbMock.setReturningRows([{ id: 'new-user-id', email: invite.email }])

    const res = await req(app).post('/users', {
      body: { ...invite, roles: ['admin'] },
    })

    expect(res.status).toBe(200)
    expect(dbMock.inserted[0]).toMatchObject({ email: invite.email })
  })

  test('a caller without USERS_UPDATE may grant a role they hold', async () => {
    permissions = []
    callerRoles = [{ id: 'alpha' }]
    dbMock.queueSelect([{ id: 'alpha' }])
    dbMock.setReturningRows([{ id: 'new-user-id', email: invite.email }])

    const res = await req(app).post('/users', {
      body: { ...invite, roles: ['alpha'] },
    })

    expect(res.status).toBe(200)
  })

  test('a caller without USERS_UPDATE cannot grant a role above their own', async () => {
    permissions = []
    callerRoles = [{ id: 'alpha' }]

    const res = await req(app).post('/users', {
      body: { ...invite, roles: ['admin'] },
    })

    expect(res.status).toBe(403)
    expect(res.body.message).toContain('your own roles')
    expect(dbMock.insertCount).toBe(0)
  })

  test('the default user role is always grantable', async () => {
    permissions = []
    callerRoles = []
    dbMock.queueSelect([{ id: 'user' }])
    dbMock.setReturningRows([{ id: 'new-user-id', email: invite.email }])

    const res = await req(app).post('/users', { body: invite })

    expect(res.status).toBe(200)
  })

  test('400s when a requested role does not exist', async () => {
    permissions = [PermissionId.USERS_UPDATE]
    dbMock.queueSelect([])

    const res = await req(app).post('/users', {
      body: { ...invite, roles: ['ghost'] },
    })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('invalid')
    expect(dbMock.insertCount).toBe(0)
  })

  test('422s on a malformed email', async () => {
    const res = await req(app).post('/users', { body: { email: 'nope' } })

    expect(res.status).toBe(422)
  })

  test('rejects a caller without the create permission', async () => {
    setHasPermission(false)

    const res = await req(app).post('/users', { body: invite })

    expect(res.status).toBe(403)
  })

  test('rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).post('/users', { body: invite })

    expect(res.status).toBe(401)
  })
})

describe('POST /users — duplicate email', () => {
  test('409s on a unique violation rather than surfacing a 500', async () => {
    dbMock.queueSelect([{ id: 'user' }])
    dbMock.db.insert = () => ({
      values: () => ({
        returning: () => {
          throw Object.assign(new Error('duplicate key'), { code: '23505' })
        },
      }),
    })

    const res = await req(app).post('/users', {
      body: { email: 'taken@parchment.test' },
    })

    expect(res.status).toBe(409)
    expect(res.body.message).toContain('already exists')
  })

  test('409s when the driver wraps the code under cause', async () => {
    dbMock.queueSelect([{ id: 'user' }])
    dbMock.db.insert = () => ({
      values: () => ({
        returning: () => {
          throw Object.assign(new Error('duplicate key'), {
            cause: { code: '23505' },
          })
        },
      }),
    })

    const res = await req(app).post('/users', {
      body: { email: 'taken@parchment.test' },
    })

    expect(res.status).toBe(409)
  })
})

describe('POST /users/:id/impersonate', () => {
  test('is refused outright in production', async () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    const res = await req(app).post('/users/other-user/impersonate')

    expect(res.status).toBe(403)
    expect(createSession).not.toHaveBeenCalled()
    process.env.NODE_ENV = previous
  })

  test('refuses self-impersonation', async () => {
    const res = await req(app).post(`/users/${TEST_USER.id}/impersonate`)

    expect(res.status).toBe(400)
    expect(createSession).not.toHaveBeenCalled()
  })

  test('404s for an unknown target', async () => {
    dbMock.queueSelect([])

    const res = await req(app).post('/users/ghost/impersonate')

    expect(res.status).toBe(404)
  })

  test('mints a session for the target outside production', async () => {
    dbMock.queueSelect([{ id: 'other-user', email: 'other@parchment.test' }])

    const res = await req(app).post('/users/other-user/impersonate')

    expect(res.status).toBe(200)
    expect(res.body.sessionId).toBe('session-other-user')
    expect(res.body.user.id).toBe('other-user')
  })
})

describe('PATCH /users/me/alias', () => {
  test('updates the alias and returns the federation handle', async () => {
    const res = await req(app).patch('/users/me/alias', { body: { alias: 'newalias' } })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      alias: 'newalias',
      handle: 'newalias@parchment.test',
    })
    expect(updateUserAlias).toHaveBeenCalledWith(TEST_USER.id, 'newalias')
  })

  test('400s on an alias that fails the format rules', async () => {
    const res = await req(app).patch('/users/me/alias', { body: { alias: 'ab' } })

    expect(res.status).toBe(400)
    expect(updateUserAlias).not.toHaveBeenCalled()
  })

  test('400s on an alias with disallowed characters', async () => {
    const res = await req(app).patch('/users/me/alias', {
      body: { alias: 'bad alias!' },
    })

    expect(res.status).toBe(400)
  })

  test('surfaces a service-level rejection (already taken)', async () => {
    updateUserAlias.mockResolvedValueOnce({
      success: false,
      error: 'Alias already taken',
    })

    const res = await req(app).patch('/users/me/alias', { body: { alias: 'taken' } })

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Alias already taken')
  })

  test('rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).patch('/users/me/alias', { body: { alias: 'x123' } })

    expect(res.status).toBe(401)
  })
})

describe('GET /users/alias/check', () => {
  test('reports an unused alias as available', async () => {
    dbMock.queueSelect([])

    const res = await req(app).get('/users/alias/check', {
      query: { alias: 'freealias' },
    })

    expect(res.body).toEqual({ available: true })
  })

  test('reports another user’s alias as taken', async () => {
    dbMock.queueSelect([{ id: 'someone-else' }])

    const res = await req(app).get('/users/alias/check', {
      query: { alias: 'takenalias' },
    })

    expect(res.body).toEqual({ available: false })
  })

  test('treats the caller’s own current alias as available', async () => {
    dbMock.queueSelect([{ id: TEST_USER.id }])

    const res = await req(app).get('/users/alias/check', {
      query: { alias: 'myalias' },
    })

    expect(res.body).toEqual({ available: true })
  })

  test('reports an invalid alias as unavailable without querying', async () => {
    const res = await req(app).get('/users/alias/check', { query: { alias: 'no' } })

    expect(res.body).toEqual({ available: false })
    expect(dbMock.selectCount).toBe(0)
  })
})

describe('PUT /users/me/keys', () => {
  test('stores both public keys', async () => {
    const res = await req(app).put('/users/me/keys', {
      body: { signingKey: 'sig-pub', encryptionKey: 'enc-pub' },
    })

    expect(res.status).toBe(200)
    expect(updateUserKeys).toHaveBeenCalledWith(TEST_USER.id, 'sig-pub', 'enc-pub')
  })

  test('422s when a key is missing', async () => {
    const res = await req(app).put('/users/me/keys', {
      body: { signingKey: 'sig-pub' },
    })

    expect(res.status).toBe(422)
    expect(updateUserKeys).not.toHaveBeenCalled()
  })
})

describe('key rotation', () => {
  test('reports the current master-key version', async () => {
    const res = await req(app).get('/users/me/km-version')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ kmVersion: 3 })
  })

  test('404s when the user row is gone', async () => {
    getUserKmVersion.mockResolvedValueOnce(null)

    const res = await req(app).get('/users/me/km-version')

    expect(res.status).toBe(404)
  })

  test('commits a rotation and returns the new version', async () => {
    const res = await req(app).post('/users/me/km-version/commit', {
      body: {
        expectedCurrent: 3,
        signingKey: 'sig',
        encryptionKey: 'enc',
        blobs: [],
        collections: [],
        slots: [],
      },
    })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ kmVersion: 4 })
    expect(commitRotation.mock.calls[0][0]).toMatchObject({
      userId: TEST_USER.id,
      expectedCurrent: 3,
    })
  })

  test('409s when another device won the rotation race', async () => {
    // The commit is CAS-gated: on conflict nothing is written, so the winning
    // device's state stays intact.
    commitRotation.mockRejectedValueOnce(new RotationConflict('version moved'))

    const res = await req(app).post('/users/me/km-version/commit', {
      body: {
        expectedCurrent: 3,
        signingKey: 'sig',
        encryptionKey: 'enc',
        blobs: [],
        collections: [],
        slots: [],
      },
    })

    expect(res.status).toBe(409)
  })
})

describe('POST /users/me/identity/reset', () => {
  test('requires the literal confirmation string', async () => {
    const res = await req(app).post('/users/me/identity/reset', {
      body: { confirm: 'yes' },
    })

    expect(res.status).toBe(422)
    expect(resetUserIdentity).not.toHaveBeenCalled()
  })

  test('requires a confirmation at all', async () => {
    const res = await req(app).post('/users/me/identity/reset', { body: {} })

    expect(res.status).toBe(422)
    expect(resetUserIdentity).not.toHaveBeenCalled()
  })

  test('wipes the identity with the right confirmation', async () => {
    const res = await req(app).post('/users/me/identity/reset', {
      body: { confirm: 'erase-all-my-data' },
    })

    expect(res.status).toBe(200)
    expect(resetUserIdentity).toHaveBeenCalledWith(TEST_USER.id)
  })

  test('rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).post('/users/me/identity/reset', {
      body: { confirm: 'erase-all-my-data' },
    })

    expect(res.status).toBe(401)
    expect(resetUserIdentity).not.toHaveBeenCalled()
  })
})

describe('pending revocations', () => {
  test('lists peers awaiting a revoke', async () => {
    const res = await req(app).get('/users/me/revocations/pending')

    expect(res.status).toBe(200)
    expect(listPendingRevocations).toHaveBeenCalledWith(TEST_USER.id)
  })

  test('delivers client-signed revoke envelopes', async () => {
    const items = [
      {
        peerHandle: 'peer@other.test',
        signature: 'sig',
        nonce: 'nonce',
        timestamp: '2026-01-01T00:00:00Z',
      },
    ]

    const res = await req(app).post('/users/me/revocations/flush', {
      body: { items },
    })

    expect(res.status).toBe(200)
    expect(flushPendingRevocations).toHaveBeenCalledWith(TEST_USER.id, items)
  })

  test('flush 422s without the signed envelopes — the server cannot sign', async () => {
    const res = await req(app).post('/users/me/revocations/flush', { body: {} })

    expect(res.status).toBe(422)
    expect(flushPendingRevocations).not.toHaveBeenCalled()
  })

  test('discards a single pending revocation', async () => {
    const res = await req(app).delete('/users/me/revocations/pending/peer@other.test')

    expect(res.status).toBeLessThan(400)
    expect(discardPendingRevocation).toHaveBeenCalled()
  })

  test('all three reject an unauthenticated caller', async () => {
    setAuthUser(null)

    expect((await req(app).get('/users/me/revocations/pending')).status).toBe(401)
    expect((await req(app).post('/users/me/revocations/flush')).status).toBe(401)
  })
})

describe('preferences', () => {
  test('returns language and unit system', async () => {
    const res = await req(app).get('/users/me/preferences')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ language: 'en-US', unitSystem: 'metric' })
  })

  test('updates only the supplied fields', async () => {
    const res = await req(app).put('/users/me/preferences', {
      body: { unitSystem: 'imperial' },
    })

    expect(res.status).toBe(200)
    expect(updateUserPreferences).toHaveBeenCalledWith(TEST_USER.id, {
      unitSystem: 'imperial',
    })
  })

  test('an empty patch reads back current preferences without writing', async () => {
    const res = await req(app).put('/users/me/preferences', { body: {} })

    expect(res.status).toBe(200)
    expect(updateUserPreferences).not.toHaveBeenCalled()
    expect(getOrCreateUserPreferences).toHaveBeenCalledWith(TEST_USER.id)
  })

  test('422s on an unknown unit system', async () => {
    const res = await req(app).put('/users/me/preferences', {
      body: { unitSystem: 'furlongs' },
    })

    expect(res.status).toBe(422)
    expect(updateUserPreferences).not.toHaveBeenCalled()
  })
})

describe('POST /users/me/onboarding/complete', () => {
  test('stamps the completion time and broadcasts it', async () => {
    const res = await req(app).post('/users/me/onboarding/complete')

    expect(res.status).toBe(200)
    expect(res.body.onboardingCompletedAt).toBeDefined()
    expect((dbMock.updated[0] as any).onboardingCompletedAt).toBeInstanceOf(Date)
    expect(emitUserProfile).toHaveBeenCalled()
  })

  test('rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).post('/users/me/onboarding/complete')

    expect(res.status).toBe(401)
    expect(dbMock.updateCount).toBe(0)
  })
})

describe('GET /users/me/identity', () => {
  test('returns the caller’s federation identity', async () => {
    const res = await req(app).get('/users/me/identity')

    expect(res.status).toBe(200)
    expect(getUserIdentity).toHaveBeenCalledWith(TEST_USER.id)
  })
})

describe('admin role and permission routes', () => {
  test('listing roles requires the roles:read permission', async () => {
    setHasPermission(false)

    const res = await req(app).get('/users/roles')

    expect(res.status).toBe(403)
  })

  test('lists roles for a permitted caller', async () => {
    dbMock.queueSelect([{ id: 'user' }, { id: 'admin' }])

    const res = await req(app).get('/users/roles')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
  })

  test('listing permissions requires the permissions:read permission', async () => {
    setHasPermission(false)

    const res = await req(app).get('/users/permissions')

    expect(res.status).toBe(403)
  })

  test('admin routes reject an unauthenticated caller', async () => {
    setAuthUser(null)

    expect((await req(app).get('/users/roles')).status).toBe(401)
    expect((await req(app).get('/users/permissions')).status).toBe(401)
    expect((await req(app).get('/users')).status).toBe(401)
  })
})
