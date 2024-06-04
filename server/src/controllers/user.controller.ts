import Elysia, { t } from 'elysia'
import { db } from '../db'
import { NewUser, users } from '../schema/user.schema'
import { usersToRoles } from '../schema/user-role.schema'
import { roles } from '../schema/role.schema'
import { eq, sql } from 'drizzle-orm'
import { permissions } from '../schema/permission.schema'
import { generateId } from '../util'
import { getRoles } from '../services/auth.service'
import md5 from 'md5'
import { sendMail } from '../services/mailer.service'

const app = new Elysia({ prefix: '/users' })

// TODO: Make permission names type safe
app
  // .use(permissions('users:read')) // TODO:
  .get(
    '/',
    async (_context) => {
      const result = await db
        .select({
          id: users.id,
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

app
  // .use(permissions('roles:read')) // TODO:
  .get(
    '/roles',
    async (_context) => {
      const result = await db.select().from(roles)
      return result
    },
    {
      detail: {
        tags: ['Users'],
      },
    },
  )

app
  // .use(permissions('permissions:read')) // TODO:
  .get('/permissions', async (_context) => {
    const result = await db.select().from(permissions)
    return result
  })

app
  // .use(permissions('users:create')) // TODO:
  .post(
    '/',
    async ({ body }) => {
      const result = await db
        .insert(users)
        .values({
          id: generateId(),
          ...body,
        })
        .returning()

      const newUser = result[0]

      await db.insert(usersToRoles).values({
        userId: newUser.id,
        roleId: 'user',
      })

      const roles = await getRoles(newUser.id)

      await sendMail({
        to: newUser.email,
        from: 'onboarding',
        subject: 'You are invited to Parchment Maps',
        template: 'invitation',
      })

      return {
        ...newUser,
        roles,
      }
    },
    {
      body: t.Object({
        firstName: t.String(),
        lastName: t.String(),
        email: t.String({
          format: 'email',
        }),
        picture: t.Optional(t.String()),
      }),
    },
  )

// app.post(
//   '/',
//   async ({ body }) => {
//     return db
//       .insert(users)
//       .values(body as NewUser)
//       .returning()
//   },
//   {
//     detail: {
//       tags: ['Users'],
//     },
//   },
// )

export default app
