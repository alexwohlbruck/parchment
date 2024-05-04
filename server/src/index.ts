import * as dotenv from 'dotenv'
dotenv.config()

import { Elysia, t } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import { cors } from '@elysiajs/cors'
import { eq } from 'drizzle-orm'
import { db } from './db'
import { generateId } from './util'
import { clientHostname, clientOrigin } from './config'
import { auth } from './middleware'
import {
  createSession,
  destroySession,
  generateWebauthnOptions,
  rpID,
  sendEmailVerificationCode,
} from './services/auth.service'
import { fetchUser, fetchUserByEmail } from './services/user.service'
import {
  createServerToken,
  validateServerToken,
} from './services/token.service'
import { NewUser, User, users } from './schema/user'
import { Passkey, passkeys } from './schema/passkey'
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server/script/deps'

const app = new Elysia()

app.use(
  cors({
    origin: [clientHostname],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Set-Cookie'],
    exposedHeaders: '*',
    methods: ['GET', 'POST', 'POST', 'PATCH', 'DELETE'],
  }),
)

app.use(
  swagger({
    documentation: {
      info: {
        title: 'Parchment API Docs',
        version: '0.1', // TODO
      },
      tags: [
        {
          name: 'Users',
          description: 'Related to retrieving and modifying users',
        },
        { name: 'Auth', description: 'Authentication endpoints' },
      ],
    },
  }),
)

app.group('/auth', (app) =>
  app
    .post('me', async () => {
      return db
        .insert(users)
        .values({
          id: '1',
          firstName: 'Alex',
          lastName: 'Wohlbruck',
          email: 'alexwohlbruck@gmail.com',
          picture: 'https://github.com/alexwohlbruck.png',
        })
        .returning()
    })
    .post(
      'verify',
      async ({ body: { email }, set }) => {
        let user = await fetchUserByEmail(email)

        if (!user) {
          const userId = generateId()

          user = (
            await db
              .insert(users)
              .values({
                id: userId,
                email,
              })
              .returning()
          )[0]
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
          description:
            'Verify an email address by requesting a one-time password.',
        },
        body: t.Object({
          email: t.String({
            format: 'email',
          }),
        }),
      },
    )

    .group('/webauthn', (app) =>
      app
        .group('/register', (app) =>
          app
            .use(auth)
            .post('/options', async ({ user, cookie: { challenge }, set }) => {
              if (!user) {
                set.status = 401
                return user
              }

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

            // Create new passkey
            .post(
              '/verify',
              async ({ body, set, user, cookie: { challenge } }) => {
                if (!user) return (set.status = 401)
                if (!challenge.value) return (set.status = 400) // TODO: Check this is how to break out with error in Elysia, make better error

                const verification = await verifyRegistrationResponse({
                  response: body as RegistrationResponseJSON,
                  expectedChallenge: challenge.value,
                  expectedOrigin: clientOrigin,
                  expectedRPID: rpID,
                  requireUserVerification: true,
                })

                if (!verification.verified) {
                  set.status = 401
                  return null
                }

                const { registrationInfo } = verification

                if (!registrationInfo) {
                  // TODO: Return correct error code and message
                  set.status = 401
                  return null
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
                      publicKey:
                        Buffer.from(credentialPublicKey).toString('base64'),
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

                return passkey
              },
              {
                detail: {
                  tags: ['Auth'],
                  description: 'Verify webauthn passkey registration.',
                },
                body: t.Object({
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
            ),
        )

        .group('/authenticate', (app) =>
          app
            .post('options', async ({ set, cookie: { challenge } }) => {
              try {
                const options = await generateWebauthnOptions('authenticate')
                challenge.value = options.challenge
                return options
              } catch (err) {
                set.status = 500
              }
            })
            .post(
              'verify',
              async ({ body, set, cookie: { challenge } }) => {
                if (!challenge.value) return (set.status = 400) // TODO: Make better error

                const passkey = (
                  await db
                    .select()
                    .from(passkeys)
                    .where(eq(passkeys.id, body.id))
                )[0]

                if (!passkey) return (set.status = 401) // TODO: Make better error

                const verification = await verifyAuthenticationResponse({
                  response: body as AuthenticationResponseJSON,
                  expectedChallenge: challenge.value,
                  expectedOrigin: clientOrigin,
                  expectedRPID: rpID,
                  authenticator: {
                    credentialID: passkey.id,
                    credentialPublicKey: Buffer.from(
                      passkey.publicKey,
                      'base64',
                    ),
                    counter: passkey.counter,
                    transports: passkey.transports.split(
                      ',',
                    ) as AuthenticatorTransportFuture[],
                  },
                })

                if (verification.verified) {
                  const user = await fetchUser(passkey.userId)
                  const session = await createSession(user.id, set)
                  set.status = 201
                  return {
                    token: session.id,
                    user,
                  }
                }

                set.status = 401
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
            ),
        ),
    )

    .group('/sessions', (app) =>
      app
        .post(
          '/',
          async ({ body: { email, token }, set, error }) => {
            const user = await fetchUserByEmail(email)

            if (!user) {
              return error(404, 'User not found')
            }

            const { id: userId } = await fetchUserByEmail(email)
            const isValid = await validateServerToken(token, 'otp', userId)

            if (!isValid) return error(401)

            const session = await createSession(user.id, set)

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

        .delete(
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
        ),
    ),
)

app.group('/users', (app) =>
  app
    .use(auth)
    .get(
      'me',
      async ({ user, set }) => {
        if (!user) {
          set.status = 401
          return null
        }
        const me = await db.select().from(users).where(eq(users.id, user.id))
        return me[0]
      },
      {
        detail: {
          tags: ['Users'],
        },
      },
    )
    .get(
      '/',
      async (_context) => {
        const result: User[] = await db.select().from(users)
        return result
      },
      {
        detail: {
          tags: ['Users'],
        },
      },
    )
    .post(
      '/',
      async ({ body }) => {
        return db
          .insert(users)
          .values(body as NewUser)
          .returning()
      },
      {
        detail: {
          tags: ['Users'],
        },
      },
    ),
)

app.onError(({ code }) => {
  if (code === 'NOT_FOUND') return 'Route not found :('
})

app.listen(5000)

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
)
