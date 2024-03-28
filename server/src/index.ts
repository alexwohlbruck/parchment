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

type TODO = any

async function fetchUser(userId: string) {
  return (await db.select().from(users).where(eq(users.id, userId)))[0]
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

async function validateToken(userId: string, token: string) {
  const found = (
    await db
      .select()
      .from(tokens)
      .where(and(eq(tokens.user_id, userId), eq(tokens.token, token)))
  )[0]

  if (!found) return false

  await db.delete(tokens).where(eq(tokens.id, found.id))
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

      const userId = generateId(15)

      const user = await db
        .insert(users)
        .values({
          id: userId,
          email,
        })
        .returning({ userId: users.id }) // TODO: This may need snake case

      const verificationCode = await generateEmailVerificationCode(userId)
      await sendEmailVerificationCode(email, verificationCode)

      return user
    })

    .post('/sessions', async ({ body, set, error }) => {
      // TODO:
      let payload = body as {
        userId: string
        otp?: string
        passkey?: string
      }

      async function signIn(method: Function, userId: string, key: string) {
        const user = await fetchUser(userId)
        if (!user) {
          return error(404, 'User not found')
        }

        const isValid = await method(userId, key)
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

      if (payload.passkey) {
        return await signIn(validatePasskey, payload.userId, payload.passkey)
      } else if (payload.userId && payload.otp) {
        return await signIn(validateToken, payload.userId, payload.otp)
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
