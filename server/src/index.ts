import { Elysia, t } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { NewUser, User, users } from './schema/user'
import { lucia } from './lucia'
import { generateId } from 'lucia'
import { generateRandomString, alphabet, sha256 } from 'oslo/crypto'
import { encodeHex } from 'oslo/encoding'
import { Token, tokens } from './schema/token'
import { auth } from './middleware'
import * as dotenv from 'dotenv'

dotenv.config()

const app = new Elysia()

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

console.log('test')

type TODO = any

async function fetchUser(userId: string) {
  return (await db.select().from(users).where(eq(users.id, userId)))[0]
}

async function fetchUserByEmail(email: string) {
  return (await db.select().from(users).where(eq(users.email, email)))[0]
}

async function createServerToken(type: Token['type'], userId: User['id']) {
  // Only one ephemeral token of a given type can exist for each user
  const ephemeralTokenTypes: Token['type'][] = ['otp']
  const isEphemeralToken = ephemeralTokenTypes.includes(type)

  if (isEphemeralToken) {
    await db
      .delete(tokens)
      .where(and(eq(tokens.user_id, userId), eq(tokens.type, type)))
  }

  let code
  switch (type) {
    case 'otp':
      code = generateRandomString(8, alphabet('0-9'))
      break
    case 'passkey':
      code = generateRandomString(24, alphabet('A-Z', 'a-z', '0-9'))
      break
  }

  const hash = encodeHex(await sha256(new TextEncoder().encode(code)))

  await db.insert(tokens).values({
    id: generateId(15),
    user_id: userId,
    hash,
    type: 'otp',
    ephemeral: isEphemeralToken,
  })

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
    .where(and(eq(tokens.type, type), eq(tokens.user_id, userId)))

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
  // TODO: Check passkey private key is valid
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

    .post(
      '/sessions',
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
      '/sessions',
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
