import Elysia from 'elysia'
import { db } from '../db'
import { NewUser, User, users } from '../schema/user.schema'
import { permissions } from '../middleware/auth.middleware'
import { usersToRoles } from '../schema/user-role.schema'
import { roles } from '../schema/role.schema'
import { eq, sql } from 'drizzle-orm'

const app = new Elysia({ prefix: '/users' })

// TODO: Make permission names type safe
app
  // .use(permissions('users:read'))
  .get(
    '/',
    async (_context) => {
      const result = await db
        .select({
          userId: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          picture: users.picture,
          roles: sql`json_agg(json_build_object(
            'id', ${roles.id},
            'name', ${roles.name}
          ))`.as('roles'),
        })
        .from(users)
        .leftJoin(usersToRoles, eq(usersToRoles.userId, users.id))
        .leftJoin(roles, eq(usersToRoles.roleId, roles.id))
        .groupBy(users.id)
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
