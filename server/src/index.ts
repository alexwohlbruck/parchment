import * as dotenv from 'dotenv'
dotenv.config()

import { Context, Elysia, t } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import { cors } from '@elysiajs/cors'
import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { NewUser, User, users } from './schema/user'
import { lucia } from './lucia'
import { generateRandomString, alphabet, sha256 } from 'oslo/crypto'
import { encodeHex } from 'oslo/encoding'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { NewToken, Token, tokens } from './schema/token'
import { auth } from './middleware'
import {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server/script/deps'
import { Passkey, passkeys } from './schema/passkey'
import { appName, clientHostname, serverHostname, clientOrigin } from './config'
import { sessions } from './schema/session'

const app = new Elysia()

const rpName = appName
const rpID = serverHostname.replace(/:\d+$/, '') // Remove port number

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

// TODO
type TODO = any

async function fetchUser(userId: string) {
  return (await db.select().from(users).where(eq(users.id, userId)))[0]
}

async function fetchUserByEmail(email: string) {
  return (await db.select().from(users).where(eq(users.email, email)))[0]
}

function generateId() {
  return generateRandomString(24, alphabet('A-Z', 'a-z', '0-9'))
}

async function createServerToken(
  type: Token['type'],
  userId: User['id'],
  value?: string,
  hashed = true,
  ephemeral = true,
) {
  if (ephemeral) {
    await db
      .delete(tokens)
      .where(and(eq(tokens.userId, userId), eq(tokens.type, type)))
  }

  let code
  if (value) {
    code = value
  } else {
    switch (type) {
      case 'otp':
        code = generateRandomString(8, alphabet('0-9'))
        break
      case 'token':
        code = generateId()
        break
    }
  }

  const payload: NewToken = {
    id: generateId(),
    userId: userId,
    type,
    ephemeral,
  }

  if (hashed) {
    payload.hash = encodeHex(await sha256(new TextEncoder().encode(code)))
  } else {
    payload.value = code
  }

  await db.insert(tokens).values(payload)

  return code
}

async function validateServerToken(
  input: string,
  type: Token['type'],
  userId: User['id'],
) {
  const matchingTokens = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.type, type), eq(tokens.userId, userId)))

  const hash = encodeHex(await sha256(new TextEncoder().encode(input)))

  for (let existing of matchingTokens) {
    if (existing.hash === hash) {
      if (existing.ephemeral) {
        await db.delete(tokens).where(eq(tokens.id, existing.id))
      }
      return true
    }
  }

  return false
}

async function sendEmailVerificationCode(email: string, code: string) {
  console.log(email, code)
  // TODO: Configure email server
  return true
}

async function authenticateUser(userId: string, set: Context['set']) {
  const session = await lucia.createSession(userId, {})
  const sessionCookie = lucia.createSessionCookie(session.id)

  set.status = 201
  set.headers = {
    ...set.headers,
    Location: '/',
    'Set-Cookie': sessionCookie.serialize(),
  }

  return session
}

async function generateWebauthnOptions(
  method: 'register' | 'authenticate',
  userId?: string,
  userName?: string,
) {
  switch (method) {
    case 'register':
      if (!userId || !userName)
        throw new Error(
          'User ID and username required for passkey registration.',
        )

      const existingPasskeys = (
        await db.select().from(passkeys).where(eq(passkeys.userId, userId))
      ).map((passkey) => ({
        id: passkey.id,
        transports: passkey.transports.split(
          ',',
        ) as AuthenticatorTransportFuture[],
      }))

      return await generateRegistrationOptions({
        rpID,
        rpName,
        userName,
        attestationType: 'none',
        excludeCredentials: existingPasskeys,
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
      })
    case 'authenticate':
      return await generateAuthenticationOptions({
        rpID,
      })
  }
}

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
                  const session = await authenticateUser(user.id, set)
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

            const session = await authenticateUser(user.id, set)

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
          async ({ cookie: { auth_session }, set }) => {
            await db.delete(sessions).where(eq(sessions.id, auth_session.value))
            auth_session.path = '/'
            auth_session.remove()
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
        console.log({ user })
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
