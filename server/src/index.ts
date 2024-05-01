import { Elysia, t } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import { cors } from '@elysiajs/cors'
import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { NewUser, User, users } from './schema/user'
import { lucia } from './lucia'
import { generateId } from 'lucia'
import { generateRandomString, alphabet, sha256 } from 'oslo/crypto'
import { encodeHex } from 'oslo/encoding'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { NewToken, Token, tokens } from './schema/token'
import { auth } from './middleware'
import * as dotenv from 'dotenv'
import { RegistrationResponseJSON } from '@simplewebauthn/server/script/deps'
import { passkeys } from './schema/passkey'

dotenv.config()

const app = new Elysia()

// TODO: Move to passkeys service
const rpName = 'Parchment Maps'
const rpID = 'parchment.lat'
const origin = `https://${rpID}`

app.use(
  cors({
    origin: ['http://localhost:5173'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Set-Cookie'],
    exposedHeaders: '*',
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

type TODO = any

async function fetchUser(userId: string) {
  return (await db.select().from(users).where(eq(users.id, userId)))[0]
}

async function fetchUserByEmail(email: string) {
  return (await db.select().from(users).where(eq(users.email, email)))[0]
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
      case 'challenge':
        code = generateRandomString(24, alphabet('A-Z', 'a-z', '0-9'))
        break
    }
  }

  const payload: NewToken = {
    id: generateId(15),
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

async function getServerToken(type: Token['type'], userId: User['id']) {
  const matchingTokens = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.type, type), eq(tokens.userId, userId)))

  return matchingTokens[0]
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

async function validatePasskey(email: string, privateKey: string) {
  // TODO: Verify passkey with
  return 1 < 2
}

async function validateOtp(email: string, token: string) {
  const { id: userId } = await fetchUserByEmail(email)
  return await validateServerToken(token, 'otp', userId)
}

app.group('/auth', (app) =>
  app
    .post(
      'verify',
      async ({ body: { email }, set, error }) => {
        let user = await fetchUserByEmail(email)

        if (!user) {
          const userId = generateId(15)

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
            .post('/options', async ({ user, session, set }) => {
              console.log({ user, session })
              if (!user) {
                set.status = 401
                return user
              }

              // TODO: Get existing passkeys for user
              // const userPasskeys = getUserPasskeys()

              const options = await generateRegistrationOptions({
                rpID,
                rpName,
                userName: user!.id, // TODO: Use non PII user id
                attestationType: 'none',
                // TODO:
                // excludeCredentials: userPasskeys.map(passkey => ({
                //   id: passkey.id,
                //   transports: passkey.transports
                // })),
                authenticatorSelection: {
                  residentKey: 'required',
                  userVerification: 'required',
                },
              })

              try {
                await createServerToken(
                  'challenge',
                  user.id,
                  options.challenge,
                  false,
                )
                return options
              } catch (err) {
                set.status = 500
              }
            })

            // Create new passkey
            .post(
              '/verify',
              async ({ body, set, user }) => {
                if (!user) return (set.status = 401)

                const challenge = (await getServerToken('challenge', user.id))
                  .value

                if (!challenge) return (set.status = 500) // TODO: Check this is how to break out with error in Elysia

                const verification = await verifyRegistrationResponse({
                  response: body as RegistrationResponseJSON,
                  expectedChallenge: challenge,
                  expectedOrigin: origin,
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

                // TODO: Verify this works
                const publicKey = Number(
                  `0x${Buffer.from(credentialPublicKey).toString('hex')}`,
                )

                await db.insert(passkeys).values({
                  id: credentialID,
                  publicKey,
                  userId: user.id,
                  webauthnUserId: user.id, // TODO: Use different, non-PII ID for this
                  counter,
                  deviceType: credentialDeviceType,
                  backedUp: credentialBackedUp,
                  transports: body.response.transports,
                })

                // TODO: Sign in user
                return 'Success'
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
            .use(auth)
            .post('options', (context) => {})
            .post('verify', (context) => {}),
        ),
    )

    .group('/sessions', (app) =>
      app
        .post(
          '/',
          async ({ body: { method, email, token }, set, error }) => {
            const user = await fetchUserByEmail(email)

            if (!user) {
              return error(404, 'User not found')
            }

            const isValid = await (method === 'passkey'
              ? validatePasskey(email, token)
              : validateOtp(email, token))

            if (!isValid) return error(401)

            const session = await lucia.createSession(user.id, {})
            const sessionCookie = lucia.createSessionCookie(session.id)

            set.status = 201
            set.headers = {
              Location: '/',
              'Set-Cookie': sessionCookie.serialize(),
              'Access-Control-Allow-Credentials': 'true',
            }

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
          async ({ cookie: { auth_session } }) => {
            auth_session.remove()
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
