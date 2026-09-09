/**
 * Endpoint tests for the custom-routes controller.
 *
 * Every route is owner-scoped: the service takes the caller's id alongside the
 * route id, and a miss is reported as 404 rather than 403 so the endpoint can't
 * be used to probe which route ids exist. Public links additionally refuse
 * user-e2ee routes, since the server can't decrypt what it would be sharing.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import {
  authMockModule,
  setAuthUser,
  setHasPermission,
  resetAuth,
  TEST_USER,
} from '../../test/auth-mock'
import { createTestApp, req } from '../../test/app'

const routeRow = {
  id: 'route-1',
  userId: TEST_USER.id,
  mode: 'cycling',
  scheme: 'server-key',
}

/** Thrown by the service when a public link is minted for a user-e2ee route. */
class PublicLinkNotAllowedOnE2eeError extends Error {
  constructor() {
    super('Public links are not available for end-to-end encrypted routes')
  }
}

const getRoutes = mock(async (_userId: string) => [routeRow])
const createRoute = mock(async (input: any) => ({ ...routeRow, ...input }))
const getRouteById = mock(
  async (_id: string, _userId: string) => routeRow as typeof routeRow | null,
)
const updateRoute = mock(
  async (_id: string, _userId: string, patch: any) =>
    ({ ...routeRow, ...patch }) as typeof routeRow | null,
)
const deleteRoute = mock(async (_id: string, _userId: string) => true)
const createPublicLink = mock(
  async (_id: string, _userId: string) =>
    ({ token: 'public-token' }) as { token: string } | null,
)
const revokePublicLink = mock(async (_id: string, _userId: string) => true)

mock.module('../../services/library/routes.service', () => ({
  getRoutes,
  createRoute,
  getRouteById,
  updateRoute,
  deleteRoute,
  createPublicLink,
  revokePublicLink,
  PublicLinkNotAllowedOnE2eeError,
}))

mock.module('../../middleware/auth.middleware.js', () => authMockModule())
mock.module('../../middleware/auth.middleware', () => authMockModule())

const routes = (await import('./routes.controller')).default
const app = createTestApp(routes)

beforeEach(() => {
  resetAuth()
  getRoutes.mockClear()
  createRoute.mockClear()
  getRouteById.mockClear()
  getRouteById.mockImplementation(async () => routeRow)
  updateRoute.mockClear()
  updateRoute.mockImplementation(async (_id, _userId, patch: any) => ({
    ...routeRow,
    ...patch,
  }))
  deleteRoute.mockClear()
  deleteRoute.mockImplementation(async () => true)
  createPublicLink.mockClear()
  createPublicLink.mockImplementation(async () => ({ token: 'public-token' }))
  revokePublicLink.mockClear()
  revokePublicLink.mockImplementation(async () => true)
})

describe('gating', () => {
  const endpoints = [
    ['get', '/routes'],
    ['post', '/routes'],
    ['get', '/routes/route-1'],
    ['put', '/routes/route-1'],
    ['delete', '/routes/route-1'],
    ['post', '/routes/route-1/public-link'],
    ['delete', '/routes/route-1/public-link'],
  ] as const

  for (const [method, path] of endpoints) {
    test(`${method.toUpperCase()} ${path} rejects an unauthenticated caller`, async () => {
      setAuthUser(null)

      const res = await req(app)[method](path, { body: {} })

      expect(res.status).toBe(401)
    })

    test(`${method.toUpperCase()} ${path} rejects a caller without library:write`, async () => {
      setHasPermission(false)

      const res = await req(app)[method](path, { body: {} })

      expect(res.status).toBe(403)
    })
  }
})

describe('GET /routes', () => {
  test('lists only the caller’s routes', async () => {
    const res = await req(app).get('/routes')

    expect(res.status).toBe(200)
    expect(getRoutes).toHaveBeenCalledWith(TEST_USER.id)
    expect(res.body).toHaveLength(1)
  })
})

describe('POST /routes', () => {
  test('creates a route owned by the caller', async () => {
    const res = await req(app).post('/routes', { body: { mode: 'cycling' } })

    expect(res.status).toBe(200)
    expect(createRoute).toHaveBeenCalledWith({
      mode: 'cycling',
      userId: TEST_USER.id,
    })
  })

  test('ignores a client-supplied userId — ownership comes from the session', async () => {
    await req(app).post('/routes', {
      body: { mode: 'walking', userId: 'someone-else' } as any,
    })

    expect((createRoute.mock.calls[0][0] as any).userId).toBe(TEST_USER.id)
  })

  test('accepts an empty body — the row is minted before content is known', async () => {
    const res = await req(app).post('/routes', { body: {} })

    expect(res.status).toBe(200)
  })

  test('422s on a mode outside the allowed set', async () => {
    const res = await req(app).post('/routes', { body: { mode: 'flying' } })

    expect(res.status).toBe(422)
    expect(createRoute).not.toHaveBeenCalled()
  })

  test('422s on an unknown encryption scheme', async () => {
    const res = await req(app).post('/routes', { body: { scheme: 'plaintext' } })

    expect(res.status).toBe(422)
  })

  test('accepts both supported schemes', async () => {
    for (const scheme of ['server-key', 'user-e2ee']) {
      const res = await req(app).post('/routes', { body: { scheme } })
      expect(res.status).toBe(200)
    }
  })
})

describe('GET /routes/:id', () => {
  test('returns the route', async () => {
    const res = await req(app).get('/routes/route-1')

    expect(res.status).toBe(200)
    expect(getRouteById).toHaveBeenCalledWith('route-1', TEST_USER.id)
  })

  test('404s for a route the caller does not own', async () => {
    getRouteById.mockResolvedValueOnce(null)

    const res = await req(app).get('/routes/someone-elses')

    // 404, not 403 — a 403 would confirm the id exists.
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Route not found' })
  })
})

describe('PUT /routes/:id', () => {
  test('updates the route scoped to the caller', async () => {
    const res = await req(app).put('/routes/route-1', { body: { mode: 'walking' } })

    expect(res.status).toBe(200)
    expect(updateRoute).toHaveBeenCalledWith('route-1', TEST_USER.id, {
      mode: 'walking',
    })
  })

  test('accepts the server-key body and stats fields', async () => {
    await req(app).put('/routes/route-1', {
      body: {
        body: { waypoints: [] },
        distance: 1200,
        duration: 600,
        elevationGain: 30,
        elevationLoss: 25,
      },
    })

    expect(updateRoute.mock.calls[0][2]).toMatchObject({ distance: 1200 })
  })

  test('accepts the user-e2ee encrypted body fields', async () => {
    await req(app).put('/routes/route-1', {
      body: { bodyEncrypted: 'cipher', bodyNonce: 'nonce' },
    })

    expect(updateRoute.mock.calls[0][2]).toMatchObject({
      bodyEncrypted: 'cipher',
      bodyNonce: 'nonce',
    })
  })

  test('accepts explicit nulls to clear stats', async () => {
    await req(app).put('/routes/route-1', {
      body: { distance: null, duration: null },
    })

    expect(updateRoute.mock.calls[0][2]).toMatchObject({
      distance: null,
      duration: null,
    })
  })

  test('404s when the update matched nothing', async () => {
    updateRoute.mockResolvedValueOnce(null)

    const res = await req(app).put('/routes/missing', { body: { mode: 'walking' } })

    expect(res.status).toBe(404)
  })

  test('422s on an invalid mode', async () => {
    const res = await req(app).put('/routes/route-1', { body: { mode: 'teleport' } })

    expect(res.status).toBe(422)
    expect(updateRoute).not.toHaveBeenCalled()
  })
})

describe('DELETE /routes/:id', () => {
  test('deletes and answers 204', async () => {
    const res = await req(app).delete('/routes/route-1')

    expect(res.status).toBe(204)
    expect(deleteRoute).toHaveBeenCalledWith('route-1', TEST_USER.id)
  })

  test('404s when there was nothing to delete', async () => {
    deleteRoute.mockResolvedValueOnce(false)

    const res = await req(app).delete('/routes/missing')

    expect(res.status).toBe(404)
  })
})

describe('POST /routes/:id/public-link', () => {
  test('mints a token for a server-key route', async () => {
    const res = await req(app).post('/routes/route-1/public-link')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ token: 'public-token' })
    expect(createPublicLink).toHaveBeenCalledWith('route-1', TEST_USER.id)
  })

  test('404s for a route the caller does not own', async () => {
    createPublicLink.mockResolvedValueOnce(null)

    const res = await req(app).post('/routes/someone-elses/public-link')

    expect(res.status).toBe(404)
  })

  test('400s when the route is end-to-end encrypted', async () => {
    // The server holds no key for a user-e2ee route, so it cannot serve one
    // over a public link.
    createPublicLink.mockRejectedValueOnce(new PublicLinkNotAllowedOnE2eeError())

    const res = await req(app).post('/routes/route-1/public-link')

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('end-to-end encrypted')
  })

  test('an unexpected service error is not swallowed as a 400', async () => {
    createPublicLink.mockRejectedValueOnce(new Error('db down'))

    const res = await req(app).post('/routes/route-1/public-link')

    expect(res.status).toBe(500)
  })
})

describe('DELETE /routes/:id/public-link', () => {
  test('revokes the link and answers 204', async () => {
    const res = await req(app).delete('/routes/route-1/public-link')

    expect(res.status).toBe(204)
    expect(revokePublicLink).toHaveBeenCalledWith('route-1', TEST_USER.id)
  })

  test('404s when there was no link to revoke', async () => {
    revokePublicLink.mockResolvedValueOnce(false)

    const res = await req(app).delete('/routes/missing/public-link')

    expect(res.status).toBe(404)
  })
})
