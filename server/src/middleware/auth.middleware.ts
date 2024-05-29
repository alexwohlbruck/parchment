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
import { and, eq } from 'drizzle-orm'
import { roleToPermissions } from '../schema/role-permission.schema'

export const getSession = (app: Elysia) =>
  app.derive(
    async ({
      request,
      cookie,
    }): Promise<{
      user: User | null
    }> => {
      // CSRF check for sessions
      if (request.method !== 'GET') {
        const originHeader = request.headers.get('Origin')
        const hostHeader = request.headers.get('Host')

        if (
          !originHeader ||
          !hostHeader ||
          !verifyRequestOrigin(originHeader, [hostHeader, origins.clientOrigin])
        ) {
          return {
            user: null,
          }
        }
      }

      // const sessionId = lucia_session.value
      const cookieHeader = request.headers.get('Cookie') ?? ''
      const sessionId = lucia.readSessionCookie(cookieHeader)
      if (!sessionId) {
        return {
          user: null,
        }
      }

      const { session, user } = await lucia.validateSession(sessionId)
      if (session && session.fresh) {
        const sessionCookie = lucia.createSessionCookie(session.id)

        cookie[sessionCookie.name].set({
          value: sessionCookie.value,
          ...sessionCookie.attributes,
        })
      }

      return {
        user,
      }
    },
  )

// Use getSession to get user ID, return 401 if user is not authenticated
export const requireAuth = (app: Elysia) =>
  app.use(getSession).derive(async ({ set, user, error }) => {
    if (!user) {
      return error(401, 'You must be signed in') // TODO: i18n
    }
    return {
      user,
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
  (allowedPermissions: Permission['id'] | Permission['id'][]) =>
  (app: Elysia) =>
    app.use(getUser).derive(async ({ user, error }) => {
      // TODO: Optimize this query for Redis caching
      const result = await db
        .select()
        .from(usersToRoles)
        .where(eq(usersToRoles.userId, user.id))
        .innerJoin(
          roleToPermissions,
          eq(usersToRoles.roleId, roleToPermissions.roleId),
        )
        .innerJoin(
          permissionsSchema,
          eq(roleToPermissions.permissionId, permissionsSchema.id),
        )

      const userPermissions = result.map(({ permission }) => permission.id)

      const hasPermission = Array.isArray(allowedPermissions)
        ? userPermissions.some((value) => allowedPermissions.includes(value))
        : userPermissions.includes(allowedPermissions)

      if (!hasPermission) {
        return error(401, 'You do not have permission to do this')
      }

      return {
        user,
      }
    })
