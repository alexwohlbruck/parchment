import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Elysia } from 'elysia'
import type { TokenGrant } from '../types/access-token.types'

let grant: TokenGrant | null = null
const authenticateAccessToken = mock(async (_secret: string) => grant)
mock.module('../services/access-token.service', () => ({
  authenticateAccessToken,
  isScopedTokenSecret: (secret: string) => secret.startsWith('pat_'),
}))
mock.module('../lucia', () => ({
  lucia: {
    readSessionCookie: () => null,
    validateSession: async (id: string) =>
      id === 'session-1'
        ? { user: { id: 'user-1' }, session: { id, userId: 'user-1', fresh: false, expiresAt: new Date() } }
        : { user: null, session: null },
  },
}))
mock.module('../services/user.service', () => ({ fetchUser: async (id: string) => ({ id }) }))
mock.module('../services/auth.service', () => ({ getPermissions: async () => [], hasPermission: () => true }))

const { requireAuth, optionalAuth } = await import('./auth.middleware')
const { createTestApp, req } = await import('../test/app')

const app = createTestApp(
  new Elysia()
    .use(requireAuth)
    .get('/library/collections', ({ user, scopes }) => ({ user: user.id, scopes }))
    .post('/library/collections', ({ user }) => ({ user: user.id }))
    .get('/auth/sessions/current', ({ user }) => ({ user: user.id })),
  new Elysia().use(optionalAuth).get('/places/details', ({ user }) => ({ user: user?.id ?? null })),
)

beforeEach(() => {
  grant = { tokenId: 'tok-1', userId: 'user-1', scopes: ['library:read'], expiresAt: null }
  authenticateAccessToken.mockClear()
})

describe('scoped tokens in the auth middleware', () => {
  test('a session reaches everything and carries no scopes', async () => {
    const res = await req(app).get('/library/collections', { token: 'session-1' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ user: 'user-1', scopes: null })
    expect(authenticateAccessToken).not.toHaveBeenCalled()
  })

  test('a token reaches a route its scope covers', async () => {
    const res = await req(app).get('/library/collections', { token: 'pat_abc' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ user: 'user-1', scopes: ['library:read'] })
  })

  test('a token without the route’s scope gets 403 naming the scope it lacks', async () => {
    const res = await req(app).post('/library/collections', { token: 'pat_abc', body: {} })
    expect(res.status).toBe(403)
    expect(res.headers.get('www-authenticate')).toBe('Bearer error="insufficient_scope", scope="library:write"')
  })

  test('a token never reaches session-only routes', async () => {
    grant!.scopes = ['places:read', 'trips:read', 'weather:read', 'library:read', 'library:write']
    const res = await req(app).get('/auth/sessions/current', { token: 'pat_abc' })
    expect(res.status).toBe(403)
    expect(res.headers.get('www-authenticate')).toBe('Bearer error="insufficient_scope"')
  })

  test('an unknown or expired token is no one', async () => {
    grant = null
    const res = await req(app).get('/library/collections', { token: 'pat_gone' })
    expect(res.status).toBe(401)
  })

  test('an optional-auth route treats an out-of-scope token as anonymous', async () => {
    const res = await req(app).get('/places/details', { token: 'pat_abc' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ user: null })
  })
})
