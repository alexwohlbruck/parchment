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
import { permissions, requireAuth } from '../middleware/auth.middleware'
import { PermissionId } from '../types/auth.types'
import {
  updateUserAlias,
  updateUserKeys,
  getUserIdentity,
} from '../services/user.service'
import {
  getOrCreateUserPreferences,
  updateUserPreferences,
} from '../services/user-preferences.service'
import { buildHandle, getServerDomain } from '../services/federation.service'
import { isValidAlias } from '../lib/crypto'

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
        ? +(sessionCountResult as { sessionCount: string | number })
            .sessionCount
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
    detail: {
      tags: ['Users'],
      summary: 'Create a new user',
    },
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

app.use(permissions(PermissionId.PERMISSIONS_READ)).get(
  '/permissions',
  async (_context) => {
    const result = await db.select().from(permissionsSchema)
    return result
  },
  {
    detail: {
      tags: ['Users'],
      summary: 'Get all permissions',
    },
  },
)

/**
 * Get current user's federation identity
 */
app.use(requireAuth).get(
  '/me/identity',
  async ({ user, status, t }) => {
    const identity = await getUserIdentity(user.id)
    if (!identity) {
      return status(404, { message: t('errors.notFound.user') })
    }
    return {
      ...identity,
      domain: getServerDomain(),
    }
  },
  {
    detail: {
      tags: ['Users', 'Federation'],
      description: 'Get current user federation identity (handle, keys)',
    },
  },
)

/**
 * Update current user's alias
 */
app.use(requireAuth).patch(
  '/me/alias',
  async ({ user, body, status }) => {
    const { alias } = body

    if (!isValidAlias(alias)) {
      return status(400, {
        message:
          'Invalid alias. Use 3-30 alphanumeric characters or underscores.',
      })
    }

    const result = await updateUserAlias(user.id, alias)

    if (!result.success) {
      return status(400, { message: result.error || 'Failed to update alias' })
    }

    return {
      alias,
      handle: buildHandle(alias),
    }
  },
  {
    body: t.Object({
      alias: t.String(),
    }),
    detail: {
      tags: ['Users', 'Federation'],
      description: 'Update current user alias (username for federation)',
    },
  },
)

/**
 * Register or update public keys
 */
app.use(requireAuth).put(
  '/me/keys',
  async ({ user, body, set }) => {
    const { signingKey, encryptionKey } = body

    await updateUserKeys(user.id, signingKey, encryptionKey)

    set.status = 200
    return { success: true }
  },
  {
    body: t.Object({
      signingKey: t.String(),
      encryptionKey: t.String(),
    }),
    detail: {
      tags: ['Users', 'Federation'],
      description: 'Register or update federation public keys',
    },
  },
)

/**
 * Get current user's preferences
 */
app.use(requireAuth).get(
  '/me/preferences',
  async ({ user }) => {
    const prefs = await getOrCreateUserPreferences(user.id)
    return {
      language: prefs.language,
      unitSystem: prefs.unitSystem,
    }
  },
  {
    detail: {
      tags: ['Users'],
      description: 'Get current user preferences (language, unit system)',
    },
  },
)

/**
 * Update current user's preferences
 */
app.use(requireAuth).put(
  '/me/preferences',
  async ({ user, body }) => {
    const updates: {
      language?: import('../lib/i18n').Language
      unitSystem?: string
    } = {}
    if (body.language !== undefined) updates.language = body.language
    if (body.unitSystem !== undefined) updates.unitSystem = body.unitSystem
    if (Object.keys(updates).length === 0) {
      const prefs = await getOrCreateUserPreferences(user.id)
      return { language: prefs.language, unitSystem: prefs.unitSystem }
    }
    const prefs = await updateUserPreferences(user.id, updates)
    return { language: prefs.language, unitSystem: prefs.unitSystem }
  },
  {
    body: t.Object({
      language: t.Optional(t.String()),
      unitSystem: t.Optional(
        t.Union([t.Literal('metric'), t.Literal('imperial')]),
      ),
    }),
    detail: {
      tags: ['Users'],
      description: 'Update current user preferences (language, unit system)',
    },
  },
)

export default app
