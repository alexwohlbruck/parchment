import { Elysia, t } from 'elysia'

import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { migrate } from 'drizzle-orm/neon-http/migrator'
import { NewUser, User, users } from './schema/users'
import { eq } from 'drizzle-orm'

const app = new Elysia()
const sql = neon(process.env.DATABASE_URL!)
const db = drizzle(sql)

await migrate(db, { migrationsFolder: 'drizzle' })

app.group('/layers', (app) =>
  app.get('/', async ({ set }) => {
    return []
  }),
)

app.group('/users', (app) =>
  app
    .get('me', async (_context) => {
      const me = await db.select().from(users).where(eq(users.id, 1))
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
