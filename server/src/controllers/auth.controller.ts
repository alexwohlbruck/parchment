import Elysia, { t } from 'elysia'
import { and, eq, desc } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../schema/user.schema'
import {
  getSession,
  requireAuth,
  getSessionId,
} from '../middleware/auth.middleware'
import { origins } from '../config'
import { Passkey, passkeys } from '../schema/passkey.schema'
import { sessions } from '../schema/session.schema'
import {
  createSession,
  destroySession,
  generateWebauthnOptions,
  rpID,
  sendEmailVerificationCode,
  getPermissions,
} from '../services/auth.service'
import { fetchUser, fetchUserByEmail } from '../services/user.service'
import {
  createServerToken,
  validateServerToken,
} from '../services/token.service'
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server/script/deps'

const app = new Elysia({ prefix: '/auth' })

app.post(
  'verify',
  async ({ body: { email }, set, error }) => {
    let user = await fetchUserByEmail(email)

    if (!user) {
      // For now, we will have an invite-only system. When the app is opened up to GP, we will use this code to create an account for new users
      return error(404, { message: 'User does not exist' }) // TODO: i18n
      // const userId = generateId()
      // user = (
      //   await db
      //     .insert(users)
      //     .values({
      //       id: userId,
      //       email,
      //     })
      //     .returning()
      // )[0]
    }

    const verificationCode = await createServerToken('otp', user.id)
    const emailSuccess = await sendEmailVerificationCode(
      user.email,
      verificationCode,
    )

    if (emailSuccess) {
      set.status = 201
    } else {
      set.status = 500
    }
  },
  {
    detail: {
      tags: ['Auth'],
      description: 'Verify an email address by requesting a one-time password.',
    },
    body: t.Object({
      email: t.String({
        format: 'email',
      }),
    }),
  },
)

app.group('/passkeys', (app) => {
  app.group('/register', (app) => {
    app
      .use(requireAuth)
      .post('/options', async ({ user, cookie: { challenge }, set }) => {
        const { email } = await fetchUser(user.id)

        try {
          const options = await generateWebauthnOptions(
            'register',
            user.id,
            email,
          )
          challenge.value = options.challenge
          return options
        } catch (err) {
          set.status = 500
        }
      })

    app.use(requireAuth).post(
      '/verify',
      async ({ body, set, user, cookie: { challenge }, error }) => {
        if (!user) return (set.status = 401)
        if (!challenge.value) return (set.status = 400) // TODO: Check this is how to break out with error in Elysia, make better error

        const payload = body as RegistrationResponseJSON & { name: string }

        const verification = await verifyRegistrationResponse({
          response: payload,
          expectedChallenge: challenge.value,
          expectedOrigin: origins.clientOrigin,
          expectedRPID: rpID,
          requireUserVerification: true,
        })

        if (!verification.verified) {
          return error(401, { message: 'Passkey verification failed' }) // TODO: i18n
        }

        const { registrationInfo } = verification

        if (!registrationInfo) {
          return error(401, { message: 'Passkey verification failed' }) // TODO: i18n
        }

        const {
          credentialID,
          credentialPublicKey,
          counter,
          credentialDeviceType,
          credentialBackedUp,
        } = registrationInfo

        const passkey: Partial<Passkey> = (
          await db
            .insert(passkeys)
            .values({
              id: credentialID,
              name: payload.name,
              publicKey: Buffer.from(credentialPublicKey).toString('base64'),
              userId: user.id,
              counter,
              deviceType: credentialDeviceType,
              backedUp: credentialBackedUp,
              transports: body.response.transports,
            })
            .returning()
        )[0]

        // TODO: Find way to automatically hide sensitive fields
        delete passkey.publicKey
        challenge.remove()

        return passkey
      },
      {
        detail: {
          tags: ['Auth'],
          description: 'Verify webauthn passkey registration.',
        },
        body: t.Object({
          name: t.String(),
          id: t.String(),
          rawId: t.String(),
          response: t.Object({
            clientDataJSON: t.String(),
            attestationObject: t.String(),
            authenticatorData: t.Optional(t.String()),
            transports: t.Optional(t.Any()),
            publicKeyAlgorithm: t.Optional(t.Any()),
            publicKey: t.Optional(t.String()),
          }),
          authenticatorAttachment: t.Any(),
          clientExtensionResults: t.Optional(t.Any()),
          type: t.String(),
        }),
      },
    )

    return app
  })

  app.group('/authenticate', (app) => {
    app.post('options', async ({ set, cookie: { challenge } }) => {
      try {
        const options = await generateWebauthnOptions('authenticate')
        challenge.value = options.challenge
        return options
      } catch (err) {
        set.status = 500
      }
    })

    app.post(
      'verify',
      async ({ body, cookie: { challenge }, set, headers, error, request }) => {
        if (!challenge.value) {
          return error(401, { message: 'Could not find challenge cookie' }) // TODO: i18n
        }

        const passkey = (
          await db.select().from(passkeys).where(eq(passkeys.id, body.id))
        )[0]

        if (!passkey) {
          return error(401, { message: 'Passkey does not exist for this user' }) // TODO: i18n
        }

        const verification = await verifyAuthenticationResponse({
          response: body as AuthenticationResponseJSON,
          expectedChallenge: challenge.value,
          expectedOrigin: origins.clientOrigin,
          expectedRPID: rpID,
          authenticator: {
            credentialID: passkey.id,
            credentialPublicKey: Buffer.from(passkey.publicKey, 'base64'),
            counter: passkey.counter,
            transports: passkey.transports.split(
              ',',
            ) as AuthenticatorTransportFuture[],
          },
        })

        if (verification.verified) {
          const user = await fetchUser(passkey.userId)
          const session = await createSession(user.id, {
            set,
            headers,
          })
          set.status = 201
          return {
            token: session.id,
            user,
          }
        }

        challenge.remove()
        return error(401, { message: 'Passkey verification failed' }) // TODO: i18n
      },
      {
        body: t.Object({
          id: t.String(),
          rawId: t.String(),
          response: t.Object({
            authenticatorData: t.String(),
            clientDataJSON: t.String(),
            signature: t.String(),
            userHandle: t.String(),
          }),
          type: t.String(),
          clientExtensionResults: t.Any(),
          authenticatorAttachment: t.String(),
        }),
      },
    )

    return app
  })

  app.use(requireAuth).get('/', async ({ user, set }) => {
    return db.select().from(passkeys).where(eq(passkeys.userId, user.id))
  })

  app
    .use(requireAuth)
    .delete('/:passkeyId', async ({ user, set, params: { passkeyId } }) => {
      await db
        .delete(passkeys)
        .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, user.id)))
      set.status = 204
    })

  return app
})

app.group('/sessions', (app) => {
  app.post(
    '/',
    async (context) => {
      const {
        body: { email, token },
        error,
      } = context
      const user = await fetchUserByEmail(email)

      if (!user) {
        return error(404, { message: 'User does not exist' })
      }

      const { id: userId } = await fetchUserByEmail(email)
      const isValid = await validateServerToken(token, 'otp', userId)

      if (!isValid) return error(401, { message: 'Invalid or expired session' }) // TODO: i18n

      const session = await createSession(user.id, context)

      return {
        token: session.id,
        user,
      }
    },
    {
      detail: {
        tags: ['Auth'],
        description:
          'Sign in a user. Exchanges a passkey or one-time password for an authentication token.',
      },
      body: t.Union([
        t.Object({
          method: t.Union([t.Literal('passkey'), t.Literal('otp')]),
          email: t.String({
            format: 'email',
          }),
          // TODO: Accept 8 digit otp or server token
          token: t.String(),
        }),
      ]),
    },
  )

  app.delete(
    '/',
    async ({ cookie, set }) => {
      destroySession(cookie)
      set.status = 204
    },
    {
      detail: {
        tags: ['Auth'],
        description: 'Sign out a user.',
      },
    },
  )

  app.use(getSession).get(
    'current',
    async ({ user, set, request }) => {
      if (!user) {
        set.status = 204
        return null
      }

      const sessionId = getSessionId(request)
      const me = (await db.select().from(users).where(eq(users.id, user.id)))[0]

      return {
        user: me,
        token: sessionId,
      }
    },
    {
      detail: {
        tags: ['Auth', 'Users'],
      },
    },
  )

  app.use(requireAuth).get('current/permissions', async ({ user }) => {
    const permissions = await getPermissions(user.id)
    return { permissions }
  })

  app.use(requireAuth).get('/', async ({ set, user }) => {
    return await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id))
      .orderBy(desc(sessions.createdAt))
  })

  app
    .use(requireAuth)
    .delete('/:sessionId', async ({ set, user, params: { sessionId } }) => {
      if (!user) return (set.status = 401)
      await db
        .delete(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, user.id)))
      return (set.status = 204)
    })

  return app
})

export default app
