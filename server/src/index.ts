import { Elysia } from 'elysia'
import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { NewUser, User, users } from './schema/user'
import { isValidEmail } from './lib/validation'
import { lucia } from './lucia'
import { generateId } from 'lucia'
import { generateRandomString, alphabet } from 'oslo/crypto'
import { tokens } from './schema/token'

const app = new Elysia()

console.log('test')

type TODO = any

async function fetchUser(userId: string) {
  return (await db.select().from(users).where(eq(users.id, userId)))[0]
}

async function fetchUserByEmail(email: string) {
  return (await db.select().from(users).where(eq(users.email, email)))[0]
}

async function generateEmailVerificationCode(userId: string) {
  await db.delete(tokens).where(eq(tokens.user_id, userId))

  const code = generateRandomString(8, alphabet('0-9'))

  await db.insert(tokens).values({
    id: generateId(15),
    user_id: userId,
    token: code,
  })

  return code
}

async function sendEmailVerificationCode(email: string, code: string) {
  console.log(email, code)
  // TODO:
}

async function validatePasskey(userId: string, privateKey: string) {
  // TODO:
  return 1 < 2
}

async function validateToken(email: string, token: string) {
  const { id: userId } = await fetchUserByEmail(email)
  const foundToken = (
    await db
      .select()
      .from(tokens)
      .where(and(eq(tokens.user_id, userId), eq(tokens.token, token)))
  )[0]

  if (!foundToken) return false

  await db.delete(tokens).where(eq(tokens.id, foundToken.id))

  return foundToken.token === token
}

app.group('/layers', (app) =>
  app.get('/', async ({ set }) => {
    return []
  }),
)

app.group('/auth', (app) =>
  app
    .post('verify', async ({ body, error }) => {
      // https://lucia-auth.com/guides/email-and-password/email-verification-codes
      let { email } = body as {
        email: string
      }

      if (!email || typeof email !== 'string' || !isValidEmail(email)) {
        return error(400, 'Invalid email')
      }

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

      const verificationCode = await generateEmailVerificationCode(user.id)
      await sendEmailVerificationCode(user.email, verificationCode)
    })

    .post('/sessions', async ({ body, set, error }) => {
      // TODO:
      let payload = body as {
        userId?: string
        passkey?: string
        // OR
        email?: string
        otp?: string
      }

      async function signIn(
        method: 'passkey' | 'token',
        identifier: string, // Email or User ID
        key: string, // Passkey or OTP code
      ) {
        const user = await (method === 'passkey'
          ? fetchUser(identifier)
          : fetchUserByEmail(identifier))

        if (!user) {
          return error(404, 'User not found')
        }

        const isValid = await (method === 'passkey'
          ? validatePasskey(identifier, key)
          : validateToken(identifier, key))

        if (!isValid) return error(401)

        return createSession(user)
      }

      async function createSession(user: User) {
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
      }

      if (payload.userId && payload.passkey) {
        return await signIn('passkey', payload.userId, payload.passkey)
      } else if (payload.email && payload.otp) {
        return await signIn('token', payload.email, payload.otp)
      } else {
        error(400, 'Provide an email or passkey')
      }
    }),
)

app.group('/users', (app) =>
  app
    .get('me', async (_context) => {
      const me = await db.select().from(users).where(eq(users.id, '1'))
      return me[0]
    })
    .get('/', async (_context) => {
      const result: User[] = await db.select().from(users)
      return result
    })
    .post('/', async ({ body }) => {
      return db
        .insert(users)
        .values(body as NewUser)
        .returning()
    }),
)

app.onError(({ code }) => {
  if (code === 'NOT_FOUND') return 'Route not found :('
})

app.listen(5000)

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
)
