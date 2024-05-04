import Elysia from 'elysia'
import { db } from '../db'
import { NewUser, User, users } from '../schema/user'
import { auth } from '../middleware/auth.middleware'
import { eq } from 'drizzle-orm'

const app = new Elysia({ prefix: '/users' })

app.use(auth).get(
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

app.get(
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

app.post(
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
)

export default app
