import { Elysia, t } from 'elysia'
import { verifyRequestOrigin } from 'lucia'
import type { User, Session } from 'lucia'
import { db } from '../db'
import { lucia } from '../lucia'
import { origins } from '../config'
import { fetchUser } from '../services/user.service'
import { usersToRoles, usersToRolesRelations } from '../schema/user-role.schema'
import {
  Permission,
  permissions as permissionsSchema,
} from '../schema/permission.schema'
import { getPermissions, hasPermission } from '../services/auth.service'
import { PermissionRule } from '../types/auth.types'
import { sessions } from '../schema/session.schema'
import { eq } from 'drizzle-orm'

/**
 * Extract session ID from either cookie or bearer token
 */
export function getSessionId(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }

  const cookieHeader = request.headers.get('Cookie') ?? ''
  return lucia.readSessionCookie(cookieHeader)
}

export const getSession = (app: Elysia) =>
  app.derive(
    async ({
      request,
      cookie,
      set,
    }): Promise<{
      user: User | null
      session: Session | null
    }> => {
      // CSRF check for cookie-based auth
      const isUsingCookie = request.headers
        .get('Cookie')
        ?.includes('auth_session')
      if (isUsingCookie && request.method !== 'GET') {
        const originHeader = request.headers.get('Origin')
        const hostHeader = request.headers.get('Host')

        if (
          !originHeader ||
          !hostHeader ||
          !verifyRequestOrigin(originHeader, [
            hostHeader,
            origins.clientOrigin!,
          ])
        ) {
          return {
            user: null,
            session: null,
          }
        }
      }

      const sessionId = getSessionId(request)
      if (!sessionId) {
        return {
          user: null,
          session: null,
        }
      }

      const result = await lucia.validateSession(sessionId)
      if (!result.session || !result.user) {
        return {
          user: null,
          session: null,
        }
      }

      const { session, user } = result

      // Only set cookie if using cookie auth
      if (isUsingCookie && session.fresh) {
        const sessionCookie = lucia.createSessionCookie(session.id)
        cookie[sessionCookie.name].set({
          value: sessionCookie.value,
          ...sessionCookie.attributes,
        })
      }

      return {
        user,
        session,
      }
    },
  )

// Use getSession to get user ID, return 401 if user is not authenticated
export const requireAuth = (app: Elysia) =>
  app.use(getSession).derive(async ({ set, user, session, error }) => {
    if (!user || !session) {
      return error(401, { message: 'You must be signed in' }) // TODO: i18n
    }
    return {
      user,
      session,
    }
  })

// When we need to retrieve the full user object
export const getUser = (app: Elysia) =>
  app.use(requireAuth).derive(async ({ user: { id } }) => {
    const user = await fetchUser(id)
    return {
      user,
    }
  })

// Require the user have certain permissions to access a route
export const permissions =
  (allowedPermissions: PermissionRule) => (app: Elysia) =>
    app.use(getUser).derive(async ({ user, error }) => {
      const userPermissions = await getPermissions(user.id)

      if (!hasPermission(userPermissions, allowedPermissions)) {
        return error(401, { message: 'You do not have permission to do this' })
      }

      return {
        user,
      }
    })
