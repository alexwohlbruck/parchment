import Elysia from 'elysia'
import { db } from '../db'
import { NewUser, User, users } from '../schema/user.schema'
import { permissions } from '../middleware/auth.middleware'

const app = new Elysia({ prefix: '/users' })

// TODO: Make permission names type safe
app.use(permissions('map.update')).get(
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
