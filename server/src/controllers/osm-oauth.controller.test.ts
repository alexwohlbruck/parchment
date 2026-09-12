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

let osmRedirectUri = ''
mock.module('../config/osm.config', () => ({
  getOsmConfig: () => ({
    clientId: 'osm-client',
    clientSecret: 'osm-secret',
    redirectUri: osmRedirectUri,
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
let removedIntegrations = 0
const deleteUserIntegrations = mock(
  async (_userId: string, _integrationId: string) => removedIntegrations,
)
const updateIntegration = mock(
  async (_id: string, _userId: string, _patch: unknown) => ({ id: 'int-1' }),
)

mock.module('../services/integration.service', () => ({
  getConfiguredIntegrations,
  createIntegration,
  deleteIntegration,
  deleteUserIntegrations,
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
  removedIntegrations = 0
  osmRedirectUri = ''
  validateAuthorizationCode.mockClear()
  createAuthorizationURL.mockClear()
  getConfiguredIntegrations.mockClear()
  createIntegration.mockClear()
  deleteIntegration.mockClear()
  deleteUserIntegrations.mockClear()
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

  test('expects the browser back when the redirect URI is this server', async () => {
    osmRedirectUri = 'https://api.parchment.test/integrations/osm/callback'

    const res = await req(app).get('/integrations/osm/authorize')

    expect(res.body.manualCallback).toBe(false)
  })

  test('asks for a manual handover when the redirect URI is elsewhere', async () => {
    // A branch preview: OSM will send the browser to the one host registered on
    // the OAuth app, which isn't this one, so the popup can never report back.
    osmRedirectUri = 'https://localhost:5000/integrations/osm/callback'

    const res = await req(app).get('/integrations/osm/authorize')

    expect(res.body.manualCallback).toBe(true)
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
  test('sends the browser on with the error when the code is missing', async () => {
    const res = await req(app).get('/integrations/osm/callback', {
      query: { state: 'generated-state' },
    })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('status=error')
    expect(res.headers.get('location')).toContain('Missing+authorization+code')
    expect(validateAuthorizationCode).not.toHaveBeenCalled()
  })

  test('sends the browser on with the error when the state is unknown', async () => {
    dbMock.queueSelect([])

    const res = await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'forged-state' },
    })

    expect(res.headers.get('location')).toContain('Invalid+or+expired+state')
    expect(validateAuthorizationCode).not.toHaveBeenCalled()
  })

  test('rejects and deletes an expired state token', async () => {
    dbMock.queueSelect([
      { ...futureStateToken(), expires: new Date(Date.now() - 1000) },
    ])

    const res = await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
    })

    expect(res.headers.get('location')).toContain('Authorization+request+expired')
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

    expect(res.headers.get('location')).toContain('status=connected')
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

  test('clears any previous connection before writing the new one', async () => {
    // Not through the readable listing: a row encrypted under a retired key is
    // absent from it, and leaving that row in place collides on the unique
    // index — which is what made reconnecting impossible.
    userIntegrations = []
    http.get.mockResolvedValueOnce({ data: { user: OSM_USER } })

    await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
    })

    expect(deleteUserIntegrations).toHaveBeenCalledWith(
      TEST_USER.id,
      'openstreetmap-account',
    )
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

    expect(res.headers.get('location')).toContain('Failed+to+fetch+OSM+user')
    expect(createIntegration).not.toHaveBeenCalled()
  })

  test('surfaces an OAuth2RequestError by its code', async () => {
    tokenExchangeError = new OAuth2RequestError('invalid_grant')

    const res = await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
    })

    expect(res.headers.get('location')).toContain('OAuth2+error%3A+invalid_grant')
    expect(createIntegration).not.toHaveBeenCalled()
  })
})

describe('GET /integrations/osm/callback — handing the result back', () => {
  test('sends the browser to the handoff page on our client origin', async () => {
    dbMock.queueSelect([futureStateToken()])
    http.get.mockResolvedValueOnce({ data: { user: OSM_USER } })

    const res = await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
    })

    // OSM's COOP header severs the popup's opener on the way through, so the
    // result can only be handed over from a page sharing the app's origin.
    expect(res.headers.get('location')).toBe(
      'https://app.parchment.test/oauth/osm.html?status=connected',
    )
  })

  test('encodes an error message rather than passing it through', async () => {
    dbMock.queueSelect([futureStateToken()])
    tokenExchangeError = new Error('boom </script><script>alert(1)</script>')

    const res = await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
    })

    const location = res.headers.get('location') ?? ''
    expect(location).not.toContain('<script>')
    expect(location).toContain('%3Cscript%3E')
  })

  test('answers with JSON when the app asks for it', async () => {
    // The manual handover: the app calls this itself with the pasted code, so
    // it wants the result, not a page to look at.
    dbMock.queueSelect([futureStateToken()])
    http.get.mockResolvedValueOnce({ data: { user: OSM_USER } })

    const res = await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
      headers: { accept: 'application/json' },
    })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'connected' })
  })

  test('reports a failure as JSON too', async () => {
    dbMock.queueSelect([futureStateToken()])
    tokenExchangeError = new OAuth2RequestError('invalid_grant')

    const res = await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
      headers: { accept: 'application/json' },
    })

    expect(res.body).toMatchObject({
      status: 'error',
      message: 'OAuth2 error: invalid_grant',
    })
  })

  test('completes without a session, authenticated by the state token', async () => {
    // OSM sends the user's browser here as a top-level navigation. The callback
    // identifies the user from the state token it validates, so it must not
    // depend on a session cookie riding along — it lives on its own Elysia
    // instance for that reason.
    setAuthUser(null)
    dbMock.queueSelect([futureStateToken()])
    http.get.mockResolvedValueOnce({ data: { user: OSM_USER } })

    const res = await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
    })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('status=connected')
  })

  test('creates the integration for the state token’s owner, not the session', async () => {
    setAuthUser(null)
    dbMock.queueSelect([futureStateToken()])
    http.get.mockResolvedValueOnce({ data: { user: OSM_USER } })

    await req(app).get('/integrations/osm/callback', {
      query: { code: 'auth-code', state: 'generated-state' },
    })

    expect(createIntegration.mock.calls[0][0]).toBe(TEST_USER.id)
    expect(createIntegration.mock.calls[0][2]).toMatchObject({
      accessToken: 'osm-access-token',
    })
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
    expect(deleteUserIntegrations).not.toHaveBeenCalled()
  })

  test('removes the caller’s OSM integration', async () => {
    removedIntegrations = 1

    const res = await req(app).post('/integrations/osm/disconnect')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(deleteUserIntegrations).toHaveBeenCalledWith(
      TEST_USER.id,
      'openstreetmap-account',
    )
  })

  test('removes a row the readable listing can’t see', async () => {
    // Undecryptable config: the listing drops the row, but it is still there
    // and still blocks reconnecting, so disconnect must clear it.
    userIntegrations = []
    removedIntegrations = 1

    const res = await req(app).post('/integrations/osm/disconnect')

    expect(res.status).toBe(200)
  })

  test('404s when there is nothing connected', async () => {
    removedIntegrations = 0

    const res = await req(app).post('/integrations/osm/disconnect')

    expect(res.status).toBe(404)
  })

  test('500s when the delete fails', async () => {
    deleteUserIntegrations.mockRejectedValueOnce(new Error('db down'))

    const res = await req(app).post('/integrations/osm/disconnect')

    expect(res.status).toBe(500)
  })
})
