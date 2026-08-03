/**
 * Endpoint tests for the auth controller under open registration with billing
 * disabled — the self-hosted configuration.
 *
 * These live in their own file because the controller reads `registrationMode`
 * and `billing` from the config module namespace, which is captured when the
 * module is evaluated. A second `mock.module` for `../config` cannot change
 * what an already-evaluated controller closed over, so the alternate config
 * needs its own module registry (and, thanks to per-file test isolation, its
 * own process).
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { authMockModule, resetAuth, TEST_USER } from '../test/auth-mock'
import { createDbMock } from '../test/db-mock'
import { createTestApp, req } from '../test/app'

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))

mock.module('../config', () => ({
  registrationMode: 'open',
  billing: { enabled: false },
  appName: 'Parchment',
  origins: {
    clientOrigin: 'https://app.parchment.test',
    serverOrigin: 'https://api.parchment.test',
    clientHostname: 'app.parchment.test',
  },
  isSelfHosted: true,
}))

const sendEmailVerificationCode = mock(async () => true)
const getPermissions = mock(async (_userId: string) => ['library:read'])
const getRoles = mock(async (_userId: string) => [{ id: 'user' }])

mock.module('../services/auth.service', () => ({
  createSession: mock(async (userId: string) => ({ id: `session-${userId}` })),
  destroySession: mock(() => undefined),
  destroyAllSessions: mock(async () => undefined),
  destroyOtherSessions: mock(async () => undefined),
  generateWebauthnOptions: mock(async () => ({ challenge: 'chal' })),
  generatePrfAssertionOptions: mock(async () => ({ challenge: 'chal' })),
  generatePrfEnrollOptionsForCredential: mock(async () => ({ challenge: 'chal' })),
  rpID: 'parchment.test',
  sendEmailVerificationCode,
  getPermissions,
  getRoles,
}))

const createOpenRegistrationUser = mock(async (email: string) => ({
  id: 'new-user',
  email,
}))
const hasUsers = mock(async () => true)

mock.module('../services/user.service', () => ({
  fetchUser: mock(async (id: string) => ({ id, email: 'user@parchment.test' })),
  fetchUserByEmail: mock(async () => null),
  createOpenRegistrationUser,
  hasUsers,
}))

mock.module('../services/token.service', () => ({
  createServerToken: mock(async () => '12345678'),
  validateServerToken: mock(async () => 'valid'),
}))

const getSubscriptionStatus = mock(async () => ({
  isPremium: false,
  isBasic: false,
  hasSubscription: false,
  tier: 'free',
}))
mock.module('../services/subscription.service', () => ({ getSubscriptionStatus }))

mock.module('@simplewebauthn/server', () => ({
  verifyAuthenticationResponse: mock(async () => ({ verified: true })),
  verifyRegistrationResponse: mock(async () => ({ verified: true })),
}))

mock.module('../util', () => ({ generateId: () => 'generated-id' }))
mock.module('../lib/passkey-aaguid', () => ({
  passkeyNameFromAAGUID: () => 'iCloud Keychain',
}))
mock.module('../middleware/auth.middleware', () => ({
  ...authMockModule(),
  getSessionId: () => 'session-for-test-user-1',
}))

const auth = (await import('./auth.controller')).default
const app = createTestApp(auth)

beforeEach(() => {
  resetAuth()
  dbMock.reset()
  createOpenRegistrationUser.mockClear()
  hasUsers.mockClear()
  getSubscriptionStatus.mockClear()
  sendEmailVerificationCode.mockClear()
  sendEmailVerificationCode.mockImplementation(async () => true)
})

describe('POST /auth/verify under open registration', () => {
  test('creates an account for an unknown email', async () => {
    const res = await req(app).post('/auth/verify', {
      body: { email: 'newcomer@parchment.test' },
    })

    expect(res.status).toBe(201)
    expect(createOpenRegistrationUser).toHaveBeenCalledWith('newcomer@parchment.test')
  })

  test('does not consult hasUsers — the invite gate is bypassed entirely', async () => {
    await req(app).post('/auth/verify', {
      body: { email: 'newcomer@parchment.test' },
    })

    expect(hasUsers).not.toHaveBeenCalled()
  })

  test('still 500s when the verification email cannot be sent', async () => {
    sendEmailVerificationCode.mockResolvedValueOnce(false)

    const res = await req(app).post('/auth/verify', {
      body: { email: 'newcomer@parchment.test' },
    })

    expect(res.status).toBe(500)
  })
})

describe('subscription reporting with billing disabled', () => {
  test('current session reports premium without querying Polar', async () => {
    dbMock.queueSelect([{ id: TEST_USER.id, email: TEST_USER.email }])

    const res = await req(app).get('/auth/sessions/current')

    expect(res.status).toBe(200)
    expect(res.body.subscription).toMatchObject({
      isPremium: true,
      isBasic: false,
      hasSubscription: false,
      tier: 'premium',
    })
    expect(getSubscriptionStatus).not.toHaveBeenCalled()
  })

  test('permissions endpoint also reports premium without a billing lookup', async () => {
    const res = await req(app).get('/auth/sessions/current/permissions')

    expect(res.status).toBe(200)
    expect(res.body.subscription.tier).toBe('premium')
    expect(getSubscriptionStatus).not.toHaveBeenCalled()
  })

  test('permissions and roles are still resolved normally', async () => {
    const res = await req(app).get('/auth/sessions/current/permissions')

    expect(res.body.permissions).toEqual(['library:read'])
    expect(res.body.roles).toEqual(['user'])
  })
})
