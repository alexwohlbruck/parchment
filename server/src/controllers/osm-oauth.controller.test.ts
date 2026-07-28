/**
 * Endpoint tests for the OSM OAuth2 controller.
 *
 * The callback renders an inline <script> that postMessages the result back to
 * the opener, so the escaping there is security-relevant: an error message
 * carrying `</script>` must not break out, and the postMessage target must
 * stay pinned to our own client origin rather than a wildcard.
 *
 * The state token is the CSRF defence for the flow — it must be looked up,
 * expiry-checked, and consumed exactly once.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { authMockModule, setAuthUser, resetAuth, TEST_USER } from '../test/auth-mock'
import { createDbMock } from '../test/db-mock'
import { createAxiosMock, axiosError } from '../test/axios-mock'
import { createTestApp, req } from '../test/app'

const http = createAxiosMock()
mock.module('axios', () => http.module)

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))

class OAuth2RequestError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

let tokenExchangeError: Error | null = null
const validateAuthorizationCode = mock(async (..._args: unknown[]) => {
  if (tokenExchangeError) throw tokenExchangeError
  return { accessToken: () => 'osm-access-token' }
})
const createAuthorizationURL = mock(
  (endpoint: string, state: string, scopes: string[]) =>
    new URL(`${endpoint}?state=${state}&scope=${scopes.join('+')}`),
)

mock.module('arctic', () => ({
  OAuth2Client: class {
    createAuthorizationURL = createAuthorizationURL
    validateAuthorizationCode = validateAuthorizationCode
  },
  generateState: () => 'generated-state',
  OAuth2RequestError,
}))

mock.module('../config/origins.config', () => ({
  serverOrigin: 'https://api.parchment.test',
  clientOrigin: 'https://app.parchment.test',
}))

mock.module('../config/osm.config', () => ({
  getOsmConfig: () => ({
    clientId: 'osm-client',
    clientSecret: 'osm-secret',
    redirectUri: '',
    authEndpoint: 'https://osm.test/oauth2/authorize',
    tokenEndpoint: 'https://osm.test/oauth2/token',
    apiBase: 'https://osm.test/api/0.6',
  }),
}))

let userIntegrations: any[] = []
const getConfiguredIntegrations = mock(async (_userId: string) => userIntegrations)
const createIntegration = mock(
  async (_userId: string, _id: string, _config: unknown) => ({ id: 'int-1' }),
)
const deleteIntegration = mock(async (_id: string, _userId: string) => true)
const updateIntegration = mock(
  async (_id: string, _userId: string, _patch: unknown) => ({ id: 'int-1' }),
)

mock.module('../services/integration.service', () => ({
  getConfiguredIntegrations,
  createIntegration,
  deleteIntegration,
  updateIntegration,
}))

mock.module('../util', () => ({ generateId: () => 'token-id' }))
mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))
mock.module('../middleware/auth.middleware', () => authMockModule())

const osmOAuth = (await import('./osm-oauth.controller')).default
const app = createTestApp(osmOAuth)

const OSM_USER = {
  id: 42,
  display_name: 'mapper',
  img: { href: 'https://osm.test/avatar.png' },
  account_created: '2020-01-01T00:00:00Z',
  changesets: { count: 120 },
  traces: { count: 3 },
}

const futureStateToken = () => ({
  id: 'token-id',
  userId: TEST_USER.id,
  type: 'token',
  value: 'generated-state',
  expires: new Date(Date.now() + 60_000),
})

const osmIntegration = {
  id: 'int-1',
  integrationId: 'openstreetmap-account',
  config: { accessToken: 'stored-token', osmUserId: 42 },
}

beforeEach(() => {
  resetAuth()
  http.reset()
  dbMock.reset()
  tokenExchangeError = null
  userIntegrations = []
  validateAuthorizationCode.mockClear()
  createAuthorizationURL.mockClear()
  getConfiguredIntegrations.mockClear()
  createIntegration.mockClear()
  deleteIntegration.mockClear()
  updateIntegration.mockClear()
})

describe('GET /integrations/osm/authorize', () => {
  test('rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).get('/integrations/osm/authorize')

    expect(res.status).toBe(401)
    expect(dbMock.insertCount).toBe(0)
  })

  test('returns an authorization URL carrying the state', async () => {
    const res = await req(app).get('/integrations/osm/authorize')

    expect(res.status).toBe(200)
    expect(res.body.url).toContain('osm.test/oauth2/authorize')
    expect(res.body.url).toContain('state=generated-state')
  })

  test('requests the scopes the app actually needs', async () => {
    await req(app).get('/integrations/osm/authorize')

    const scopes = createAuthorizationURL.mock.calls[0][2]
    expect(scopes).toEqual(['read_prefs', 'write_notes', 'write_api'])
  })

  test('persists the state bound to the caller, marked ephemeral', async () => {
    await req(app).get('/integrations/osm/authorize')

    expect(dbMock.inserted[0]).toMatchObject({
      userId: TEST_USER.id,
      type: 'token',
      value: 'generated-state',
      ephemeral: true,
    })
  })

  test('clears any earlier state token for the caller first', async () => {
    await req(app).get('/integrations/osm/authorize')

    expect(dbMock.deleteCount).toBe(1)
  })

  test('gives the state a one-hour lifetime', async () => {
    await req(app).get('/integrations/osm/authorize')

    const expires = (dbMock.inserted[0] as any).expires as Date
    const ttl = expires.getTime() - Date.now()
    expect(ttl).toBeGreaterThan(59 * 60_000)
    expect(ttl).toBeLessThanOrEqual(60 * 60_000)
  })
})

describe('GET /integrations/osm/callback — state validation', () => {
  test('renders an error page when the code is missing', async () => {
    const res = await req(app).get('/integrations/osm/callback', {
      query: { state: 'generated-state' },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(String(res.body)).toContain('Missing authorization code or state')
    expect(validateAuthorizationCode).not.toHaveBeenCalled()
  })

  test('renders an error page when the state is unknown', async () => {
    dbMock.queueSelect([])

    const res = await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'forged-state' },
    })

    expect(String(res.body)).toContain('Invalid or expired state parameter')
    expect(validateAuthorizationCode).not.toHaveBeenCalled()
  })

  test('rejects and deletes an expired state token', async () => {
    dbMock.queueSelect([
      { ...futureStateToken(), expires: new Date(Date.now() - 1000) },
    ])

    const res = await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
    })

    expect(String(res.body)).toContain('Authorization request expired')
    expect(dbMock.deleteCount).toBe(1)
    expect(validateAuthorizationCode).not.toHaveBeenCalled()
  })

  test('consumes the state token before exchanging the code', async () => {
    dbMock.queueSelect([futureStateToken()])
    http.get.mockResolvedValueOnce({ data: { user: OSM_USER } })

    await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
    })

    // Single-use: the row is removed so a replayed callback can't reuse it.
    expect(dbMock.deleteCount).toBe(1)
  })
})

describe('GET /integrations/osm/callback — success path', () => {
  beforeEach(() => {
    dbMock.queueSelect([futureStateToken()])
  })

  test('stores the integration against the state’s user', async () => {
    http.get.mockResolvedValueOnce({ data: { user: OSM_USER } })

    const res = await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
    })

    expect(String(res.body)).toContain('"status":"connected"')
    expect(createIntegration.mock.calls[0][0]).toBe(TEST_USER.id)
    expect(createIntegration.mock.calls[0][2]).toMatchObject({
      accessToken: 'osm-access-token',
      osmUserId: 42,
      osmDisplayName: 'mapper',
      osmChangesetCount: 120,
      osmTraceCount: 3,
    })
  })

  test('fetches the OSM profile with the freshly issued token', async () => {
    http.get.mockResolvedValueOnce({ data: { user: OSM_USER } })

    await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
    })

    expect(http.get.mock.calls[0][0]).toBe('https://osm.test/api/0.6/user/details.json')
    expect(http.get.mock.calls[0][1].headers.Authorization).toBe(
      'Bearer osm-access-token',
    )
  })

  test('replaces an existing OSM integration rather than duplicating it', async () => {
    userIntegrations = [osmIntegration]
    http.get.mockResolvedValueOnce({ data: { user: OSM_USER } })

    await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
    })

    expect(deleteIntegration).toHaveBeenCalledWith('int-1', TEST_USER.id)
    expect(createIntegration).toHaveBeenCalled()
  })

  test('defaults missing changeset and trace counts to zero', async () => {
    http.get.mockResolvedValueOnce({
      data: { user: { id: 7, display_name: 'newbie' } },
    })

    await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
    })

    expect(createIntegration.mock.calls[0][2]).toMatchObject({
      osmChangesetCount: 0,
      osmTraceCount: 0,
    })
  })

  test('errors when OSM returns no user object', async () => {
    http.get.mockResolvedValueOnce({ data: {} })

    const res = await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
    })

    expect(String(res.body)).toContain('Failed to fetch OSM user details')
    expect(createIntegration).not.toHaveBeenCalled()
  })

  test('surfaces an OAuth2RequestError by its code', async () => {
    tokenExchangeError = new OAuth2RequestError('invalid_grant')

    const res = await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
    })

    expect(String(res.body)).toContain('OAuth2 error: invalid_grant')
    expect(createIntegration).not.toHaveBeenCalled()
  })
})

describe('GET /integrations/osm/callback — callback page safety', () => {
  test('targets the postMessage at our client origin, not a wildcard', async () => {
    dbMock.queueSelect([futureStateToken()])
    http.get.mockResolvedValueOnce({ data: { user: OSM_USER } })

    const res = await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
    })

    expect(String(res.body)).toContain("'https://app.parchment.test'")
    expect(String(res.body)).not.toContain("postMessage(, '*')")
  })

  test('escapes </script> in an error message so it cannot break out', async () => {
    dbMock.queueSelect([futureStateToken()])
    tokenExchangeError = new Error('boom </script><script>alert(1)</script>')

    const res = await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
    })

    const html = String(res.body)
    // The raw closing tag must never appear inside the inline script payload.
    expect(html).not.toContain('</script><script>alert(1)')
    expect(html).toContain('\\u003c/script')
  })

  test('falls back to a redirect when there is no opener', async () => {
    dbMock.queueSelect([futureStateToken()])
    http.get.mockResolvedValueOnce({ data: { user: OSM_USER } })

    const res = await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
    })

    expect(String(res.body)).toContain(
      'https://app.parchment.test/settings/integrations?osm=connected',
    )
  })

  test('currently requires a session, inherited from the earlier guard', async () => {
    // The callback is declared with a bare `app.get(...)`, but the preceding
    // `app.use(requireAuth).get('/authorize', ...)` mutates the shared instance,
    // so every route after it inherits the guard. OSM sends the user's browser
    // here as a top-level navigation, so a SameSite=Lax session cookie does
    // ride along and the flow works — but the callback is authenticated by the
    // session rather than by the state token it goes on to validate.
    setAuthUser(null)
    dbMock.queueSelect([futureStateToken()])
    http.get.mockResolvedValueOnce({ data: { user: OSM_USER } })

    const res = await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
    })

    expect(res.status).toBe(401)
  })
})

describe('GET /integrations/osm/profile', () => {
  test('rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).get('/integrations/osm/profile')

    expect(res.status).toBe(401)
  })

  test('404s when the caller has no OSM integration', async () => {
    userIntegrations = []

    const res = await req(app).get('/integrations/osm/profile')

    expect(res.status).toBe(404)
  })

  test('400s when the stored integration has no access token', async () => {
    userIntegrations = [{ ...osmIntegration, config: {} }]

    const res = await req(app).get('/integrations/osm/profile')

    expect(res.status).toBe(400)
  })

  test('returns fresh profile data and refreshes the stored config', async () => {
    userIntegrations = [osmIntegration]
    http.get.mockResolvedValueOnce({ data: { user: OSM_USER } })

    const res = await req(app).get('/integrations/osm/profile')

    expect(res.status).toBe(200)
    expect(res.body.osmDisplayName).toBe('mapper')
    expect(updateIntegration.mock.calls[0][2]).toMatchObject({
      config: expect.objectContaining({ osmDisplayName: 'mapper' }),
    })
  })

  test('preserves the access token when refreshing the config', async () => {
    userIntegrations = [osmIntegration]
    http.get.mockResolvedValueOnce({ data: { user: OSM_USER } })

    await req(app).get('/integrations/osm/profile')

    expect((updateIntegration.mock.calls[0][2] as any).config.accessToken).toBe(
      'stored-token',
    )
  })

  test('502s when OSM returns no user object', async () => {
    userIntegrations = [osmIntegration]
    http.get.mockResolvedValueOnce({ data: {} })

    const res = await req(app).get('/integrations/osm/profile')

    expect(res.status).toBe(502)
  })

  test('401s when the stored token has been revoked upstream', async () => {
    userIntegrations = [osmIntegration]
    http.get.mockRejectedValueOnce(axiosError(401, 'unauthorized'))

    const res = await req(app).get('/integrations/osm/profile')

    expect(res.status).toBe(401)
    expect(res.body.message).toContain('invalid or expired')
  })

  test('500s on other upstream failures', async () => {
    userIntegrations = [osmIntegration]
    http.get.mockRejectedValueOnce(new Error('network down'))

    const res = await req(app).get('/integrations/osm/profile')

    expect(res.status).toBe(500)
  })
})

describe('POST /integrations/osm/disconnect', () => {
  test('rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).post('/integrations/osm/disconnect')

    expect(res.status).toBe(401)
    expect(deleteIntegration).not.toHaveBeenCalled()
  })

  test('removes the caller’s OSM integration', async () => {
    userIntegrations = [osmIntegration]

    const res = await req(app).post('/integrations/osm/disconnect')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(deleteIntegration).toHaveBeenCalledWith('int-1', TEST_USER.id)
  })

  test('404s when there is nothing connected', async () => {
    userIntegrations = []

    const res = await req(app).post('/integrations/osm/disconnect')

    expect(res.status).toBe(404)
    expect(deleteIntegration).not.toHaveBeenCalled()
  })

  test('500s when the delete fails', async () => {
    userIntegrations = [osmIntegration]
    deleteIntegration.mockRejectedValueOnce(new Error('db down'))

    const res = await req(app).post('/integrations/osm/disconnect')

    expect(res.status).toBe(500)
  })
})
