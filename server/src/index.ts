import { Elysia, NotFoundError } from 'elysia'
import { eq } from 'drizzle-orm'
import { db } from './db'
import { NewUser, User, users } from './schema/user'
import { isValidEmail } from './lib/validation'
import { lucia } from './lucia'

const app = new Elysia()

type TODO = any

app.group('/layers', (app) =>
  app.get('/', async ({ set }) => {
    return []
  }),
)

app.group('/sessions', (app) =>
  app.post('/', async ({ body, set, error }) => {
    const email = (body as TODO).email

    if (!email || typeof email !== 'string' || !isValidEmail(email)) {
      error(400, 'Invalid email')
    }

    // TODO: Get user by id service method
    const user = (
      await db.select().from(users).where(eq(users.email, email))
    )[0]

    if (!user) {
      return new Response('Invalid email or password', {
        status: 400,
      })
    }

    // TODO: Validate passkey
    // const validPassword = await new Argon2id().verify(
    //   user.hashed_password,
    //   password,
    // )
    // if (!validPassword) {
    //   return new Response('Invalid email or password', {
    //     status: 400,
    //   })
    // }

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
