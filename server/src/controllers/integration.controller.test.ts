/**
 * Endpoint tests for the integration controller.
 *
 * Permissions here are scope-based rather than a single flag: user-scope rows
 * need integrations:write-user, system-scope rows need
 * integrations:write-system, and the checks are per-row rather than per-route.
 * The important negatives are that a user-scope permission must not unlock a
 * system row (which would leak, for instance, which users linked an OSM
 * account via /dependents), and that `/configured` exposes only fields the
 * definition marks public — never a stored API key.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { authMockModule, setAuthUser, resetAuth, TEST_USER } from '../test/auth-mock'
import { createTestApp, req } from '../test/app'
import { PermissionId } from '../types/auth.types'

/** Permissions the caller currently holds. */
let permissions: string[] = []

const getPermissions = mock(async (_userId: string) => permissions)
const hasPermission = mock((perms: string[], required: string) =>
  perms.includes(required),
)
mock.module('../services/auth.service', () => ({ getPermissions, hasPermission }))

class IntegrationSchemeConflictError extends Error {}

const systemRow = {
  id: 'sys-1',
  integrationId: 'barrelman',
  userId: null,
  scheme: 'server-key',
  config: { host: 'https://barrelman.test', apiKey: 'secret-key' },
  capabilities: [{ id: 'search' }],
  encryptedConfig: null,
}

const userRow = {
  id: 'usr-1',
  integrationId: 'dawarich',
  userId: TEST_USER.id,
  scheme: 'user-e2ee',
  config: { url: 'https://dawarich.test', apiToken: 'user-secret' },
  capabilities: [{ id: 'location-history' }],
  encryptedConfig: 'opaque-envelope',
}

let systemIntegrations: any[] = [systemRow]
let userIntegrations: any[] = [userRow]

const getConfiguredIntegrations = mock(async (userId?: string) =>
  userId ? userIntegrations : systemIntegrations,
)

/** Integration lookups keyed by id; the user variant is scoped by construction. */
let lookup: Record<string, any> = { 'sys-1': systemRow, 'usr-1': userRow }
const getIntegration = mock(async (id: string, _userId?: string) => lookup[id] ?? null)

let definitions: Record<string, any> = {
  barrelman: {
    name: 'Barrelman',
    scope: ['system'],
    schemes: ['server-key'],
    configFields: [{ key: 'host', public: true }, { key: 'apiKey' }],
  },
  dawarich: {
    name: 'Dawarich',
    scope: ['user'],
    schemes: ['server-key', 'user-e2ee'],
    configFields: [{ key: 'url', public: true }, { key: 'apiToken' }],
  },
}
const getIntegrationDefinition = mock((id: string) => definitions[id] ?? null)

const extractPublicConfig = mock((config: Record<string, any>, definition: any) => {
  const out: Record<string, any> = {}
  for (const field of definition?.configFields ?? []) {
    if (field.public && config[field.key] !== undefined) out[field.key] = config[field.key]
  }
  return out
})

const createIntegration = mock(
  async (_userId: string | null, _id: string, _config: any, ..._rest: any[]) => ({
    id: 'created-1',
  }),
)
const updateIntegration = mock(
  async (_id: string, _userId: string | null, _patch: any) => ({ id: 'usr-1' }),
)
const deleteIntegration = mock(async (_id: string, _userId?: string | null) => true)
const testIntegrationConfig = mock(async (_id: string, _config: any) => ({
  success: true,
}))
const getAvailableIntegrations = mock(async (..._args: any[]) => [
  { integrationId: 'barrelman', scope: ['system'] },
])
const getDependentIntegrations = mock(async (_id: string) => [
  { id: 'dep-1', integrationId: 'openstreetmap-account', userId: 'other-user' },
])

mock.module('../services/integration.service', () => ({
  getIntegration,
  createIntegration,
  updateIntegration,
  deleteIntegration,
  testIntegrationConfig,
  getConfiguredIntegrations,
  getAvailableIntegrations,
  getIntegrationDefinition,
  extractPublicConfig,
  getDependentIntegrations,
  IntegrationSchemeConflictError,
}))

mock.module('../services/integrations', () => ({
  integrationManager: {
    getCachedIntegrationInstance: () => ({ capabilities: { search: { metadata: null } } }),
  },
}))

mock.module('../services/observability.config', () => ({
  refreshObservability: mock(async () => undefined),
}))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
}))

mock.module('../middleware/auth.middleware', () => authMockModule())

const integrations = (await import('./integration.controller')).default
const app = createTestApp(integrations)

// Use the real enum rather than string literals — the ids are colon-separated
// (`integrations:write:system`), which is easy to get subtly wrong by hand.
const WRITE_USER = PermissionId.INTEGRATIONS_WRITE_USER
const WRITE_SYSTEM = PermissionId.INTEGRATIONS_WRITE_SYSTEM
const READ_USER = PermissionId.INTEGRATIONS_READ_USER

beforeEach(() => {
  resetAuth()
  permissions = []
  systemIntegrations = [systemRow]
  userIntegrations = [userRow]
  lookup = { 'sys-1': systemRow, 'usr-1': userRow }
  definitions = {
    barrelman: {
      name: 'Barrelman',
      scope: ['system'],
      schemes: ['server-key'],
      configFields: [{ key: 'host', public: true }, { key: 'apiKey' }],
    },
    dawarich: {
      name: 'Dawarich',
      scope: ['user'],
      schemes: ['server-key', 'user-e2ee'],
      configFields: [{ key: 'url', public: true }, { key: 'apiToken' }],
    },
  }
  getPermissions.mockClear()
  getConfiguredIntegrations.mockClear()
  getIntegration.mockClear()
  createIntegration.mockClear()
  updateIntegration.mockClear()
  deleteIntegration.mockClear()
  testIntegrationConfig.mockClear()
  testIntegrationConfig.mockImplementation(async () => ({ success: true }))
  getAvailableIntegrations.mockClear()
  getDependentIntegrations.mockClear()
})

describe('GET /integrations/configured', () => {
  test('serves an anonymous caller', async () => {
    // web/src/App.vue calls fetchConfiguredIntegrations() on mount for ALL
    // users to pick up the Mapbox token and OSM server URL, so a signed-out
    // visitor opening a /public/... share link needs this to succeed or the
    // map renders with no engine configured. The route therefore lives on its
    // own Elysia instance — a bare `.use(requireAuth)` applies retroactively
    // to routes declared before it on the same instance.
    setAuthUser(null)

    const res = await req(app).get('/integrations/configured')

    expect(res.status).toBe(200)
  })

  test('returns system integrations to an anonymous caller', async () => {
    setAuthUser(null)

    const res = await req(app).get('/integrations/configured')

    expect(res.body.map((i: any) => i.id)).toEqual(['sys-1'])
  })

  test('withholds user integrations from an anonymous caller', async () => {
    setAuthUser(null)

    const res = await req(app).get('/integrations/configured')

    expect(res.body.every((i: any) => i.userId === undefined)).toBe(true)
  })

  test('never exposes non-public config fields', async () => {
    const res = await req(app).get('/integrations/configured')

    const systemDto = res.body.find((i: any) => i.id === 'sys-1')
    expect(systemDto.config).toEqual({ host: 'https://barrelman.test' })
    expect(JSON.stringify(res.body)).not.toContain('secret-key')
  })

  test('omits user fields on system rows', async () => {
    const res = await req(app).get('/integrations/configured')

    const systemDto = res.body.find((i: any) => i.id === 'sys-1')
    expect(systemDto.userId).toBeUndefined()
    expect(systemDto.encryptedConfig).toBeUndefined()
  })

  test('adds the caller’s own integrations when they may read them', async () => {
    permissions = [READ_USER]

    const res = await req(app).get('/integrations/configured')

    expect(res.body).toHaveLength(2)
    const userDto = res.body.find((i: any) => i.id === 'usr-1')
    expect(userDto.userId).toBe(TEST_USER.id)
    expect(userDto.encryptedConfig).toBe('opaque-envelope')
  })

  test('withholds user integrations without the read permission', async () => {
    permissions = []

    const res = await req(app).get('/integrations/configured')

    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe('sys-1')
  })

  test('user rows are also stripped to public config only', async () => {
    permissions = [READ_USER]

    const res = await req(app).get('/integrations/configured')

    const userDto = res.body.find((i: any) => i.id === 'usr-1')
    expect(userDto.config).toEqual({ url: 'https://dawarich.test' })
    expect(JSON.stringify(res.body)).not.toContain('user-secret')
  })
})

describe('authenticated routes', () => {
  const routes = [
    ['get', '/integrations/available'],
    ['get', '/integrations/sys-1'],
    ['post', '/integrations'],
    ['put', '/integrations/usr-1'],
    ['delete', '/integrations/usr-1'],
    ['get', '/integrations/usr-1/dependents'],
    ['post', '/integrations/test'],
  ] as const

  for (const [method, path] of routes) {
    test(`${method.toUpperCase()} ${path} rejects an unauthenticated caller`, async () => {
      setAuthUser(null)

      const res = await req(app)[method](path, {
        body: { integrationId: 'dawarich', config: {} },
      })

      expect(res.status).toBe(401)
    })
  }
})

describe('GET /integrations/:id — scope-matched write permission', () => {
  test('returns the full config to a caller with system write', async () => {
    permissions = [WRITE_SYSTEM]

    const res = await req(app).get('/integrations/sys-1')

    expect(res.status).toBe(200)
    // This route intentionally returns the secret — it backs the edit form.
    expect(res.body.config.apiKey).toBe('secret-key')
  })

  test('403s when the caller only holds user write on a system row', async () => {
    permissions = [WRITE_USER]

    const res = await req(app).get('/integrations/sys-1')

    expect(res.status).toBe(403)
  })

  test('returns a user row to a caller with user write', async () => {
    permissions = [WRITE_USER]

    const res = await req(app).get('/integrations/usr-1')

    expect(res.status).toBe(200)
    expect(res.body.config.apiToken).toBe('user-secret')
  })

  test('403s with no write permission at all', async () => {
    permissions = []

    const res = await req(app).get('/integrations/usr-1')

    expect(res.status).toBe(403)
  })

  test('404s for an unknown integration', async () => {
    permissions = [WRITE_SYSTEM, WRITE_USER]
    lookup = {}

    const res = await req(app).get('/integrations/nope')

    expect(res.status).toBe(404)
  })

  test('404s when the definition is missing', async () => {
    permissions = [WRITE_SYSTEM, WRITE_USER]
    definitions = {}

    const res = await req(app).get('/integrations/sys-1')

    expect(res.status).toBe(404)
  })
})

describe('POST /integrations', () => {
  const body = { integrationId: 'dawarich', config: { url: 'https://d.test' } }

  test('creates a user-scope integration with user write permission', async () => {
    permissions = [WRITE_USER]

    const res = await req(app).post('/integrations', { body })

    expect(res.status).toBeLessThan(400)
    expect(createIntegration).toHaveBeenCalled()
  })

  test('400s on an integration id outside the enum', async () => {
    permissions = [WRITE_USER, WRITE_SYSTEM]

    const res = await req(app).post('/integrations', {
      body: { integrationId: 'not-a-real-integration', config: {} },
    })

    expect(res.status).toBe(400)
    expect(createIntegration).not.toHaveBeenCalled()
  })

  test('400s when the definition is unknown', async () => {
    permissions = [WRITE_USER, WRITE_SYSTEM]
    definitions = {}

    const res = await req(app).post('/integrations', { body })

    expect(res.status).toBe(400)
    expect(createIntegration).not.toHaveBeenCalled()
  })

  test('refuses to create a user-scope row without user write', async () => {
    permissions = [WRITE_SYSTEM]

    const res = await req(app).post('/integrations', { body })

    expect(res.status).toBe(403)
    expect(createIntegration).not.toHaveBeenCalled()
  })
})

describe('PUT /integrations/:id', () => {
  test('400s when neither config nor capabilities are supplied', async () => {
    permissions = [WRITE_USER]

    const res = await req(app).put('/integrations/usr-1', { body: {} })

    expect(res.status).toBe(400)
    expect(updateIntegration).not.toHaveBeenCalled()
  })

  test('404s for an unknown integration', async () => {
    permissions = [WRITE_USER, WRITE_SYSTEM]
    lookup = {}

    const res = await req(app).put('/integrations/nope', {
      body: { config: { url: 'x' } },
    })

    expect(res.status).toBe(404)
  })

  test('updates a user row with user write permission', async () => {
    permissions = [WRITE_USER]
    lookup = { 'usr-1': userRow }

    const res = await req(app).put('/integrations/usr-1', {
      body: { config: { url: 'https://new.test' } },
    })

    expect(res.status).toBeLessThan(400)
  })

  test('403s updating a system row with only user write', async () => {
    permissions = [WRITE_USER]
    lookup = { 'sys-1': systemRow }

    const res = await req(app).put('/integrations/sys-1', {
      body: { config: { host: 'https://new.test' } },
    })

    expect(res.status).toBe(403)
    expect(updateIntegration).not.toHaveBeenCalled()
  })
})

describe('DELETE /integrations/:id', () => {
  test('404s for an unknown integration', async () => {
    permissions = [WRITE_USER, WRITE_SYSTEM]
    lookup = {}

    const res = await req(app).delete('/integrations/nope')

    expect(res.status).toBe(404)
    expect(deleteIntegration).not.toHaveBeenCalled()
  })

  test('403s deleting a system row with only user write', async () => {
    permissions = [WRITE_USER]
    lookup = { 'sys-1': systemRow }

    const res = await req(app).delete('/integrations/sys-1')

    expect(res.status).toBe(403)
    expect(deleteIntegration).not.toHaveBeenCalled()
  })

  test('deletes a user row with user write permission', async () => {
    permissions = [WRITE_USER]
    lookup = { 'usr-1': userRow }

    const res = await req(app).delete('/integrations/usr-1')

    expect(res.status).toBeLessThan(400)
    expect(deleteIntegration).toHaveBeenCalled()
  })
})

describe('GET /integrations/:id/dependents', () => {
  test('404s for an integration the caller cannot see', async () => {
    permissions = [WRITE_USER, WRITE_SYSTEM]
    lookup = {}

    const res = await req(app).get('/integrations/nope/dependents')

    expect(res.status).toBe(404)
    expect(getDependentIntegrations).not.toHaveBeenCalled()
  })

  test('403s listing SYSTEM dependents with only user write', async () => {
    // Otherwise a regular user could enumerate which users configured a
    // dependent integration (e.g. linked OSM accounts).
    permissions = [WRITE_USER]

    const res = await req(app).get('/integrations/sys-1/dependents')

    expect(res.status).toBe(403)
    expect(getDependentIntegrations).not.toHaveBeenCalled()
  })

  test('lists system dependents with system write', async () => {
    permissions = [WRITE_SYSTEM]

    const res = await req(app).get('/integrations/sys-1/dependents')

    expect(res.status).toBe(200)
    expect(getDependentIntegrations).toHaveBeenCalled()
  })

  test('403s listing user dependents without user write', async () => {
    permissions = [WRITE_SYSTEM]

    const res = await req(app).get('/integrations/usr-1/dependents')

    expect(res.status).toBe(403)
  })

  test('never leaks the owning userId of a dependent', async () => {
    permissions = [WRITE_SYSTEM]

    const res = await req(app).get('/integrations/sys-1/dependents')

    expect(JSON.stringify(res.body)).not.toContain('other-user')
  })
})

describe('POST /integrations/test', () => {
  test('400s on an unknown integration id', async () => {
    permissions = [WRITE_USER, WRITE_SYSTEM]

    const res = await req(app).post('/integrations/test', {
      body: { integrationId: 'not-real', config: {} },
    })

    expect(res.status).toBe(400)
    expect(testIntegrationConfig).not.toHaveBeenCalled()
  })

  test('400s when the definition is unknown', async () => {
    permissions = [WRITE_USER, WRITE_SYSTEM]
    definitions = {}

    const res = await req(app).post('/integrations/test', {
      body: { integrationId: 'dawarich', config: {} },
    })

    expect(res.status).toBe(400)
  })

  test('403s testing a user-scope config without user write', async () => {
    permissions = [WRITE_SYSTEM]

    const res = await req(app).post('/integrations/test', {
      body: { integrationId: 'dawarich', config: {} },
    })

    expect(res.status).toBe(403)
    expect(testIntegrationConfig).not.toHaveBeenCalled()
  })

  test('runs the connection check with the right permission', async () => {
    permissions = [WRITE_USER]

    const res = await req(app).post('/integrations/test', {
      body: { integrationId: 'dawarich', config: { url: 'https://d.test' } },
    })

    expect(res.status).toBeLessThan(400)
    expect(testIntegrationConfig).toHaveBeenCalled()
  })
})

describe('GET /integrations/available', () => {
  test('is permission-aware', async () => {
    permissions = [READ_USER]

    const res = await req(app).get('/integrations/available')

    expect(res.status).toBe(200)
    expect(getAvailableIntegrations).toHaveBeenCalled()
  })
})
