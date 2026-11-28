import { Elysia, t } from 'elysia'
import { verifyRequestOrigin } from 'lucia'
import type { User, Session } from 'lucia'
import { lucia } from '../lucia'
import { origins } from '../config'
import { fetchUser } from '../services/user.service'
import { getPermissions, hasPermission } from '../services/auth.service'
import { PermissionRule } from '../types/auth.types'
import { i18nPlugin } from '../lib/i18n/plugin'
import { insufficientScopeChallenge, routeAccess } from '../lib/auth/token-scopes'
import {
  authenticateAccessToken,
  isScopedTokenSecret,
} from '../services/access-token.service'
import type { TokenScope } from '../types/access-token.types'

export type RequestAuth = {
  user: User | null
  session: Session | null
  /** Null for a full session; what the token may reach otherwise. */
  scopes: TokenScope[] | null
  /** Set when a scoped token was presented but may not reach this route. */
  denied: { scope: TokenScope | null } | null
}

const anonymous: RequestAuth = { user: null, session: null, scopes: null, denied: null }

const NEVER = new Date('9999-12-31T00:00:00Z')

async function scopedTokenAuth(secret: string, request: Request): Promise<RequestAuth> {
  const grant = await authenticateAccessToken(secret)
  if (!grant) return anonymous
  const access = routeAccess(grant.scopes, request.method, new URL(request.url).pathname)
  if (!access.allowed) {
    return { ...anonymous, scopes: grant.scopes, denied: { scope: access.scope } }
  }
  return {
    user: { id: grant.userId },
    session: {
      id: grant.tokenId,
      userId: grant.userId,
      fresh: false,
      expiresAt: grant.expiresAt ?? NEVER,
    },
    scopes: grant.scopes,
    denied: null,
  }
}

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
    }): Promise<RequestAuth> => {
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
          return anonymous
        }
      }

      const sessionId = getSessionId(request)
      if (!sessionId) return anonymous
      if (isScopedTokenSecret(sessionId)) return scopedTokenAuth(sessionId, request)

      const result = await lucia.validateSession(sessionId)
      if (!result.session || !result.user) return anonymous

      const { session, user } = result

      // Only set cookie if using cookie auth
      if (isUsingCookie && session.fresh) {
        const sessionCookie = lucia.createSessionCookie(session.id)
        cookie[sessionCookie.name].set({
          value: sessionCookie.value,
          ...sessionCookie.attributes,
        })
      }

      return { user, session, scopes: null, denied: null }
    },
  )

export const optionalAuth = (app: Elysia) =>
  app.use(getSession).derive(async ({ user, session, scopes }) => {
    return { user, session, scopes }
  })

export const requireAuth = (app: Elysia) =>
  app.use(i18nPlugin).use(getSession).derive(async ({ user, session, scopes, denied, set, status, t }) => {
    if (denied) {
      set.headers['www-authenticate'] = insufficientScopeChallenge(denied.scope)
      return status(403, {
        message: t(denied.scope ? 'errors.auth.tokenScope' : 'errors.auth.tokenNotAllowed'),
      })
    }
    if (!user || !session) {
      return status(401, { message: t('errors.auth.unauthorized') })
    }
    return {
      user,
      session,
      scopes,
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
    app.use(getUser).derive(async ({ user, status, t }) => {
      const userPermissions = await getPermissions(user.id)

      if (!hasPermission(userPermissions, allowedPermissions)) {
        return status(403, { message: t('errors.auth.forbidden') })
      }

      return {
        user,
      }
    })
