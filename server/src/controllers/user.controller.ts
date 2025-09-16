import Elysia, { t } from 'elysia'
import { db } from '../db'
import { User, users } from '../schema/users.schema'
import { usersToRoles } from '../schema/users-roles.schema'
import { roles } from '../schema/roles.schema'
import { sessions } from '../schema/sessions.schema'
import { eq, sql } from 'drizzle-orm'
import { permissions as permissionsSchema } from '../schema/permissions.schema'
import { generateId } from '../util'
import { getRoles } from '../services/auth.service'
import { sendMail } from '../services/mailer.service'
import { permissions } from '../middleware/auth.middleware'
import { PermissionId } from '../types/auth.types'

const app = new Elysia({ prefix: '/users' })

// TODO: Make permission names type safe
app.use(permissions(PermissionId.USERS_READ)).get(
  '/',
  async (_context) => {
    const usersResult = await db
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

    const sessionCounts = await db
      .select({
        userId: sessions.userId,
        sessionCount: sql`COUNT(*) AS session_count`,
      })
      .from(sessions)
      .groupBy(sessions.userId)

    const usersWithSessionCounts = usersResult.map((user) => {
      const sessionCountResult = sessionCounts.find(
        (sessionCount) => sessionCount.userId === user.id,
      )
      const sessionCount = sessionCountResult
        ? +sessionCountResult.sessionCount
        : 0
      return { ...user, sessionCount }
    })

    return usersWithSessionCounts
  },
  {
    detail: {
      tags: ['Users'],
    },
  },
)

app.use(permissions(PermissionId.USERS_CREATE)).post(
  '/',
  async ({ body }) => {
    // TODO: Require new permission to add users with elevated privileges

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
      roleId: body.role || 'user',
    })

    const roles = await getRoles(newUser.id)

    // Populate default layers for new user
    await populateDefaultLayers(newUser.id)

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
      role: t.Optional(
        t.Union([t.Literal('user'), t.Literal('alpha'), t.Literal('admin')]),
      ),
    }),
  },
)

app.use(permissions(PermissionId.ROLES_READ)).get(
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
  .use(permissions(PermissionId.PERMISSIONS_READ))
  .get('/permissions', async (_context) => {
    const result = await db.select().from(permissionsSchema)
    return result
  })

export default app
