/**
 * Endpoint tests for the auth controller.
 *
 * The security-relevant behaviours pinned here:
 *   - `/verify` must not become an open-registration hole: in invite mode an
 *     unknown email 404s once any user exists, and only bootstraps a user on a
 *     genuinely empty instance;
 *   - the OTP exchange rejects a bad code with 401 and never mints a session;
 *   - session deletion is always scoped to the caller's own user id;
 *   - `/sessions/current` answers 204 (not 401) when signed out, because the
 *     client polls it to decide whether it *is* signed in.
 *
 * WebAuthn registration/authentication verification is mocked — the crypto is
 * @simplewebauthn's job and is covered by its own suite; what matters here is
 * the wiring and the guard placement.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { authMockModule, setAuthUser, resetAuth, TEST_USER } from '../test/auth-mock'
import { createDbMock } from '../test/db-mock'
import { createTestApp, req } from '../test/app'

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))

let registrationMode = 'invite'
let billingEnabled = true

mock.module('../config', () => ({
  get registrationMode() {
    return registrationMode
  },
  get billing() {
    return { enabled: billingEnabled }
  },
  appName: 'Parchment',
  origins: {
    clientOrigin: 'https://app.parchment.test',
    serverOrigin: 'https://api.parchment.test',
    clientHostname: 'app.parchment.test',
  },
  isSelfHosted: false,
}))

const createSession = mock(async (userId: string, _ctx: unknown) => ({
  id: `session-for-${userId}`,
}))
const destroySession = mock((_cookie: unknown) => undefined)
const destroyAllSessions = mock(async (_userId: string) => undefined)
const destroyOtherSessions = mock(
  async (_userId: string, _sessionId: string, _deviceId: string) => undefined,
)
const sendEmailVerificationCode = mock(
  async (_email: string, _code: string) => true,
)
const getPermissions = mock(async (_userId: string) => ['library:read'])
const getRoles = mock(async (_userId: string) => [{ id: 'user' }])
const generatePrfAssertionOptions = mock(async (_userId: string) => ({
  challenge: 'chal',
}))
const generatePrfEnrollOptionsForCredential = mock(
  async (_userId: string, _credentialId: string) =>
    ({ challenge: 'chal' }) as unknown,
)

mock.module('../services/auth.service', () => ({
  createSession,
  destroySession,
  destroyAllSessions,
  destroyOtherSessions,
  generateWebauthnOptions: mock(async () => ({ challenge: 'chal' })),
  generatePrfAssertionOptions,
  generatePrfEnrollOptionsForCredential,
  rpID: 'parchment.test',
  sendEmailVerificationCode,
  getPermissions,
  getRoles,
}))

let existingUser: any = { id: 'user-1', email: 'user@parchment.test' }
let anyUsersExist = true

const fetchUserByEmail = mock(async (_email: string) => existingUser)
const fetchUser = mock(async (id: string) => ({ id, email: 'user@parchment.test' }))
const createOpenRegistrationUser = mock(async (email: string) => ({
  id: 'new-user',
  email,
}))
const hasUsers = mock(async () => anyUsersExist)

mock.module('../services/user.service', () => ({
  fetchUser,
  fetchUserByEmail,
  createOpenRegistrationUser,
  hasUsers,
}))

const createServerToken = mock(
  async (_type: string, _userId: string, fixed?: string) => fixed ?? '12345678',
)
let tokenValid = true
const validateServerToken = mock(
  async (_token: string, _type: string, _userId: string) => tokenValid,
)

mock.module('../services/token.service', () => ({
  createServerToken,
  validateServerToken,
}))

const getSubscriptionStatus = mock(async (_userId: string) => ({
  isPremium: false,
  isBasic: true,
  hasSubscription: true,
  tier: 'basic',
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
  registrationMode = 'invite'
  billingEnabled = true
  existingUser = { id: 'user-1', email: 'user@parchment.test' }
  anyUsersExist = true
  tokenValid = true
  createSession.mockClear()
  destroySession.mockClear()
  destroyAllSessions.mockClear()
  destroyOtherSessions.mockClear()
  sendEmailVerificationCode.mockClear()
  sendEmailVerificationCode.mockImplementation(async () => true)
  createServerToken.mockClear()
  validateServerToken.mockClear()
  fetchUserByEmail.mockClear()
  createOpenRegistrationUser.mockClear()
  hasUsers.mockClear()
  getPermissions.mockClear()
  getRoles.mockClear()
  getSubscriptionStatus.mockClear()
  generatePrfAssertionOptions.mockClear()
  generatePrfEnrollOptionsForCredential.mockClear()
  generatePrfEnrollOptionsForCredential.mockImplementation(async () => ({
    challenge: 'chal',
  }))
})

describe('POST /auth/verify', () => {
  test('issues an OTP for a known user', async () => {
    const res = await req(app).post('/auth/verify', {
      body: { email: 'user@parchment.test' },
    })

    expect(res.status).toBe(201)
    expect(createServerToken).toHaveBeenCalled()
    expect(sendEmailVerificationCode).toHaveBeenCalled()
  })

  test('404s for an unknown email in invite mode once users exist', async () => {
    existingUser = null
    anyUsersExist = true

    const res = await req(app).post('/auth/verify', {
      body: { email: 'stranger@parchment.test' },
    })

    // Invite-only: this endpoint must not double as open registration.
    expect(res.status).toBe(404)
    expect(createOpenRegistrationUser).not.toHaveBeenCalled()
  })

  test('bootstraps the first user on an empty invite-mode instance', async () => {
    existingUser = null
    anyUsersExist = false

    const res = await req(app).post('/auth/verify', {
      body: { email: 'founder@parchment.test' },
    })

    expect(res.status).toBe(201)
    expect(createOpenRegistrationUser).toHaveBeenCalledWith('founder@parchment.test')
  })

  // Open-registration mode is covered in auth.controller.open-mode.test.ts —
  // `registrationMode` is read from the config module namespace at import, so
  // a second value needs its own module registry.

  test('uses the fixed code and skips email for the app tester account', async () => {
    process.env.APP_TESTER_EMAIL = 'tester@parchment.test'
    existingUser = { id: 'tester', email: 'tester@parchment.test' }

    const res = await req(app).post('/auth/verify', {
      body: { email: 'tester@parchment.test' },
    })

    expect(res.status).toBe(201)
    expect(createServerToken.mock.calls[0][2]).toBe('00000000')
    expect(sendEmailVerificationCode).not.toHaveBeenCalled()
  })

  test('500s when the verification email fails to send', async () => {
    sendEmailVerificationCode.mockResolvedValueOnce(false)

    const res = await req(app).post('/auth/verify', {
      body: { email: 'user@parchment.test' },
    })

    expect(res.status).toBe(500)
  })

  test('422s on a malformed email', async () => {
    const res = await req(app).post('/auth/verify', { body: { email: 'not-an-email' } })

    expect(res.status).toBe(422)
    expect(createServerToken).not.toHaveBeenCalled()
  })

  test('is unauthenticated — sign-in starts here', async () => {
    setAuthUser(null)

    const res = await req(app).post('/auth/verify', {
      body: { email: 'user@parchment.test' },
    })

    expect(res.status).toBe(201)
  })
})

describe('POST /auth/sessions — OTP exchange', () => {
  const body = {
    method: 'otp',
    email: 'user@parchment.test',
    token: '12345678',
  }

  test('exchanges a valid OTP for a session token', async () => {
    const res = await req(app).post('/auth/sessions', { body })

    expect(res.status).toBe(200)
    expect(res.body.token).toBe('session-for-user-1')
    expect(res.body.user.id).toBe('user-1')
  })

  test('validates the OTP against that user before minting anything', async () => {
    await req(app).post('/auth/sessions', { body })

    expect(validateServerToken).toHaveBeenCalledWith('12345678', 'otp', 'user-1')
  })

  test('401s on an invalid OTP and mints no session', async () => {
    tokenValid = false

    const res = await req(app).post('/auth/sessions', { body })

    expect(res.status).toBe(401)
    expect(createSession).not.toHaveBeenCalled()
  })

  test('404s for an unknown email', async () => {
    existingUser = null

    const res = await req(app).post('/auth/sessions', { body })

    expect(res.status).toBe(404)
    expect(validateServerToken).not.toHaveBeenCalled()
  })

  test('422s without a token', async () => {
    const res = await req(app).post('/auth/sessions', {
      body: { method: 'otp', email: 'user@parchment.test' },
    })

    expect(res.status).toBe(422)
  })

  test('422s on an unknown sign-in method', async () => {
    const res = await req(app).post('/auth/sessions', {
      body: { ...body, method: 'password' },
    })

    expect(res.status).toBe(422)
  })

  test('is reachable without an existing session', async () => {
    setAuthUser(null)

    const res = await req(app).post('/auth/sessions', { body })

    expect(res.status).toBe(200)
  })
})

describe('session teardown', () => {
  test('DELETE /auth/sessions signs the caller out', async () => {
    const res = await req(app).delete('/auth/sessions')

    expect(res.status).toBe(204)
    expect(destroySession).toHaveBeenCalled()
  })

  test('DELETE /auth/sessions/all destroys every session for the caller', async () => {
    const res = await req(app).delete('/auth/sessions/all')

    expect(res.status).toBe(204)
    expect(destroyAllSessions).toHaveBeenCalledWith(TEST_USER.id)
  })

  test('DELETE /auth/sessions/all rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).delete('/auth/sessions/all')

    expect(res.status).toBe(401)
    expect(destroyAllSessions).not.toHaveBeenCalled()
  })

  test('DELETE /auth/sessions/others keeps the current session', async () => {
    const res = await req(app).delete('/auth/sessions/others', {
      body: { deviceId: 'device-abc123' },
    })

    expect(res.status).toBe(204)
    expect(destroyOtherSessions).toHaveBeenCalledWith(
      TEST_USER.id,
      'test-session-1',
      'device-abc123',
    )
  })

  test('DELETE /auth/sessions/others 422s on a malformed device id', async () => {
    const res = await req(app).delete('/auth/sessions/others', {
      body: { deviceId: 'bad id!' },
    })

    expect(res.status).toBe(422)
    expect(destroyOtherSessions).not.toHaveBeenCalled()
  })

  test('DELETE /auth/sessions/:id is scoped to the caller’s own sessions', async () => {
    const res = await req(app).delete('/auth/sessions/some-session')

    expect(res.status).toBe(204)
    // The WHERE clause pairs the session id with the caller's user id, so a
    // token belonging to another user can't be revoked here.
    expect(dbMock.deleteCount).toBe(1)
  })

  test('DELETE /auth/sessions/:id rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).delete('/auth/sessions/some-session')

    expect(res.status).toBe(401)
    expect(dbMock.deleteCount).toBe(0)
  })
})

describe('GET /auth/sessions/current', () => {
  test('returns the user, token and subscription when signed in', async () => {
    dbMock.queueSelect([{ id: TEST_USER.id, email: TEST_USER.email }])

    const res = await req(app).get('/auth/sessions/current')

    expect(res.status).toBe(200)
    expect(res.body.user.id).toBe(TEST_USER.id)
    expect(res.body.subscription.tier).toBe('basic')
  })

  test('answers 204 when signed out, not 401', async () => {
    // The client polls this to decide whether it *is* signed in, so a signed
    // out caller must get the handler's `if (!user)` branch rather than a
    // guard rejection. That branch was unreachable until the `/all` and
    // `/others` routes were moved into their own `.group('')` scope: Elysia's
    // `.use()` leaks forward, so their requireAuth was inherited here.
    setAuthUser(null)

    const res = await req(app).get('/auth/sessions/current')

    expect(res.status).toBe(204)
  })

  test('sign-in and sign-out stay reachable without a session', async () => {
    // Same guard-leak class as above: these sit on the /sessions instance
    // alongside requireAuth'd routes. Pinned so a future route added in the
    // wrong place can't quietly lock anonymous callers out of signing in.
    setAuthUser(null)

    const signIn = await req(app).post('/auth/sessions', {
      body: { method: 'otp', email: TEST_USER.email, token: '12345678' },
    })
    expect(signIn.status).toBe(200)

    const signOut = await req(app).delete('/auth/sessions')
    expect(signOut.status).toBe(204)
  })
})

describe('GET /auth/sessions/current/permissions', () => {
  test('returns permissions, roles and subscription together', async () => {
    const res = await req(app).get('/auth/sessions/current/permissions')

    expect(res.status).toBe(200)
    expect(res.body.permissions).toEqual(['library:read'])
    expect(res.body.roles).toEqual(['user'])
    expect(res.body.subscription.tier).toBe('basic')
  })

  // The billing-disabled shape is covered in auth.controller.open-mode.test.ts.

  test('rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).get('/auth/sessions/current/permissions')

    expect(res.status).toBe(401)
    expect(getPermissions).not.toHaveBeenCalled()
  })
})

describe('GET /auth/sessions', () => {
  test('lists the caller’s sessions', async () => {
    dbMock.queueSelect([{ id: 'session-1' }, { id: 'session-2' }])

    const res = await req(app).get('/auth/sessions')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
  })

  test('rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).get('/auth/sessions')

    expect(res.status).toBe(401)
  })
})

describe('passkey management', () => {
  test('lists the caller’s passkeys', async () => {
    dbMock.queueSelect([{ id: 'pk-1', name: 'iCloud Keychain' }])

    const res = await req(app).get('/auth/passkeys')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  test('deleting a passkey is scoped to the caller', async () => {
    const res = await req(app).delete('/auth/passkeys/pk-1')

    expect(res.status).toBe(204)
    expect(dbMock.deleteCount).toBe(1)
  })

  test('passkey routes reject an unauthenticated caller', async () => {
    setAuthUser(null)

    expect((await req(app).get('/auth/passkeys')).status).toBe(401)
    expect((await req(app).delete('/auth/passkeys/pk-1')).status).toBe(401)
  })
})

describe('PRF option endpoints', () => {
  test('assertion options are minted for the caller', async () => {
    const res = await req(app).post('/auth/passkeys/prf-assert/options')

    expect(res.status).toBe(200)
    expect(generatePrfAssertionOptions).toHaveBeenCalledWith(TEST_USER.id)
  })

  test('enroll options are scoped to one credential', async () => {
    const res = await req(app).post('/auth/passkeys/cred-1/prf-enroll/options')

    expect(res.status).toBe(200)
    expect(generatePrfEnrollOptionsForCredential).toHaveBeenCalledWith(
      TEST_USER.id,
      'cred-1',
    )
  })

  test('enroll options 404 for a credential the caller does not own', async () => {
    generatePrfEnrollOptionsForCredential.mockResolvedValueOnce(null)

    const res = await req(app).post('/auth/passkeys/someone-elses/prf-enroll/options')

    expect(res.status).toBe(404)
  })

  test('both reject an unauthenticated caller', async () => {
    setAuthUser(null)

    expect((await req(app).post('/auth/passkeys/prf-assert/options')).status).toBe(401)
    expect(
      (await req(app).post('/auth/passkeys/cred-1/prf-enroll/options')).status,
    ).toBe(401)
  })

  test('429s past 30 assertion-option requests a minute', async () => {
    // These hand out WebAuthn challenges; a session holder could otherwise
    // burn them in a loop.
    setAuthUser({ ...TEST_USER, id: 'prf-flood' })

    let last = { status: 200 } as { status: number }
    for (let i = 0; i < 31; i++) {
      last = await req(app).post('/auth/passkeys/prf-assert/options')
    }

    expect(last.status).toBe(429)
  })
})
