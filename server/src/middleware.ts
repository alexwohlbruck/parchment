import { Elysia } from 'elysia'
import { verifyRequestOrigin } from 'lucia'
import type { User, Session } from 'lucia'
import { lucia } from './lucia'
import { allowedOrigins } from './config'

export const auth = (app: Elysia) =>
  app.derive(
    async ({
      request,
      cookie,
    }): Promise<{
      user: User | null
      session: Session | null
    }> => {
      // CSRF check for sessions
      if (request.method !== 'GET') {
        const originHeader = request.headers.get('Origin')
        const hostHeader = request.headers.get('Host')

        if (
          !originHeader ||
          !hostHeader ||
          !verifyRequestOrigin(originHeader, [hostHeader, ...allowedOrigins])
        ) {
          return {
            user: null,
            session: null,
          }
        }
      }

      // const sessionId = lucia_session.value
      const cookieHeader = request.headers.get('Cookie') ?? ''
      const sessionId = lucia.readSessionCookie(cookieHeader)
      if (!sessionId) {
        return {
          user: null,
          session: null,
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
        session,
      }
    },
  )
