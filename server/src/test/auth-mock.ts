/**
 * Stand-in for `middleware/auth.middleware` in controller tests.
 *
 * Controller tests care about routing, validation, status codes and service
 * wiring — not about how Lucia validates a session. Replacing the middleware
 * keeps them fast and DB-free while still exercising the guard *decision*,
 * which is what the routes branch on.
 *
 * `mock.module` paths resolve relative to the calling file, so each test file
 * passes its own path:
 *
 *   import { authMockModule, setAuthUser, TEST_USER } from '../test/auth-mock'
 *   mock.module('../middleware/auth.middleware', () => authMockModule())
 *
 * The injected identity is read per request, so a single test file covers both
 * sides of the guard:
 *
 *   setAuthUser(null)                    // guarded routes now 401
 *   setHasPermission(false)              // permission-gated routes now 403
 *   resetAuth()                          // back to the default TEST_USER
 *
 * Because an unguarded route would keep returning 200 with no user, the
 * `setAuthUser(null)` case also proves the route is guarded at all.
 */

import { Elysia } from 'elysia'

export interface TestUser {
  id: string
  email: string
  alias: string
  [key: string]: unknown
}

/** Default identity injected into authenticated routes. */
export const TEST_USER: TestUser = {
  id: 'test-user-1',
  email: 'test-user@parchment.test',
  alias: 'testuser',
}

export const TEST_SESSION = {
  id: 'test-session-1',
  userId: TEST_USER.id,
  fresh: false,
  expiresAt: new Date('2099-01-01T00:00:00Z'),
}

let currentUser: TestUser | null = TEST_USER
let currentHasPermission = true

/** Set the identity seen by subsequent requests; `null` makes guards 401. */
export function setAuthUser(user: TestUser | null): void {
  currentUser = user
}

/** When false, `permissions(...)`-guarded routes reject with 403. */
export function setHasPermission(allowed: boolean): void {
  currentHasPermission = allowed
}

/** Restore the default authenticated state — call in `beforeEach`. */
export function resetAuth(): void {
  currentUser = TEST_USER
  currentHasPermission = true
}

function currentSession() {
  return currentUser ? { ...TEST_SESSION, userId: currentUser.id } : null
}

/**
 * Build a replacement module for `auth.middleware`. Every export is covered so
 * a controller can import any guard without reaching the real implementation.
 */
export function authMockModule() {
  /** Injects the identity, or 401s when there isn't one. */
  const guard = (app: Elysia) =>
    app.derive(({ status }: any) => {
      const user = currentUser
      const session = currentSession()
      if (!user || !session) return status(401, { message: 'Unauthorized' })
      return { user, session }
    })

  /** Non-blocking variant — leaves `user` null instead of rejecting. */
  const optional = (app: Elysia) =>
    app.derive(() => ({ user: currentUser, session: currentSession() }))

  return {
    getSessionId: () => (currentUser ? TEST_SESSION.id : null),
    getSession: optional,
    optionalAuth: optional,
    requireAuth: guard,
    getUser: guard,
    permissions: () => (app: Elysia) =>
      app.derive(({ status }: any) => {
        const user = currentUser
        const session = currentSession()
        if (!user || !session) return status(401, { message: 'Unauthorized' })
        if (!currentHasPermission) return status(403, { message: 'Forbidden' })
        return { user, session }
      }),
  }
}
