import Elysia, { t } from 'elysia'
import { db } from '../db'
import { User, users } from '../schema/users.schema'
import { usersToRoles } from '../schema/users-roles.schema'
import { roles } from '../schema/roles.schema'
import { sessions } from '../schema/sessions.schema'
import { eq, sql, count, and, ne, inArray } from 'drizzle-orm'
import { permissions as permissionsSchema } from '../schema/permissions.schema'
import { roleToPermissions } from '../schema/roles-permissions.schema'
import { lucia } from '../lucia'
import { generateId } from '../util'
import { getRoles } from '../services/auth.service'
import { sendMail } from '../services/mailer.service'
import { permissions, requireAuth } from '../middleware/auth.middleware'
import { PermissionId } from '../types/auth.types'
import {
  updateUserAlias,
  updateUserKeys,
  getUserIdentity,
  updateUserDisplayProfile,
} from '../services/user.service'
import { resetUserIdentity } from '../services/identity-reset.service'
import {
  getUserKmVersion,
  commitRotation,
  RotationConflict,
} from '../services/km-rotation.service'
import {
  getOrCreateUserPreferences,
  updateUserPreferences,
} from '../services/user-preferences.service'
import { createInitialCollection } from '../services/library/collections.service'
import {
  listPendingRevocations,
  flushPendingRevocations,
  discardPendingRevocation,
} from '../services/revocations.service'
import { buildHandle, getServerDomain } from '../services/federation.service'
import { isValidAlias } from '../lib/crypto'

import { billing } from '../config'
import { logger } from '../lib/logger'
import { getAdminUserSubscriptionInfo } from '../services/subscription.service'
import { i18next } from 'elysia-i18next'
import { detectLanguage, getI18nInitOptions } from '../lib/i18n'

const app = new Elysia({ prefix: '/users' })

// Admin routes — scoped inside a group so the permissions() middleware
// does not leak into the /me/* routes below.
app.group('', (admin) =>
  admin
    .use(permissions(PermissionId.USERS_READ))
    .get(
      '/',
      async ({ query }) => {
        const page = Math.max(1, query.page ?? 1)
        const limit = Math.min(100, Math.max(1, query.limit ?? 25))
        const offset = (page - 1) * limit

        const [totalResult] = await db
          .select({ total: count() })
          .from(users)

        const usersResult = await db
          .select({
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
            alias: users.alias,
            picture: users.picture,
            createdAt: users.createdAt,
            roles: sql`COALESCE(json_agg(json_build_object(
                'id', ${roles.id},
                'name', ${roles.name}
              )) FILTER (WHERE ${roles.id} IS NOT NULL), '[]')`.as('roles'),
          })
          .from(users)
          .leftJoin(usersToRoles, eq(usersToRoles.userId, users.id))
          .leftJoin(roles, eq(usersToRoles.roleId, roles.id))
          .groupBy(users.id)
          .limit(limit)
          .offset(offset)

        const userIds = usersResult.map((u) => u.id)

        const sessionCounts =
          userIds.length > 0
            ? await db
                .select({
                  userId: sessions.userId,
                  sessionCount: sql<number>`count(*)`.as('session_count'),
                })
                .from(sessions)
                .where(inArray(sessions.userId, userIds))
                .groupBy(sessions.userId)
            : []

        const sessionCountMap = new Map(
          sessionCounts.map((s) => [s.userId, +s.sessionCount]),
        )

        const usersWithSessionCounts = usersResult.map((user) => ({
          ...user,
          sessionCount: sessionCountMap.get(user.id) ?? 0,
        }))

        return {
          data: usersWithSessionCounts,
          total: totalResult.total,
          page,
          limit,
        }
      },
      {
        query: t.Object({
          page: t.Optional(t.Numeric({ minimum: 1 })),
          limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        }),
        detail: {
          tags: ['Users'],
        },
      },
    ),
)

app.group('', (admin) =>
  admin
    .use(permissions(PermissionId.USERS_CREATE))
    .post(
      '/',
      async ({ body, status }) => {
        // Validate role exists if specified
        const roleId = body.role || 'user'
        const [roleRow] = await db
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.id, roleId))
          .limit(1)

        if (!roleRow) {
          return status(400, { message: `Role "${roleId}" not found` })
        }

        const result = await db
          .insert(users)
          .values({
            id: generateId(),
            firstName: body.firstName,
            lastName: body.lastName,
            email: body.email,
            picture: body.picture,
          })
          .returning()

        const newUser = result[0]

        await db.insert(usersToRoles).values({
          userId: newUser.id,
          roleId,
        })

        await createInitialCollection(newUser.id)

        const userRoles = await getRoles(newUser.id)

        await sendMail({
          to: newUser.email,
          from: 'onboarding',
          subject: 'You are invited to Parchment Maps',
          template: 'invitation',
        })

        return {
          ...newUser,
          roles: userRoles,
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
          role: t.Optional(t.String()),
        }),
        detail: {
          tags: ['Users'],
          summary: 'Create a new user',
        },
      },
    ),
)

app.group('', (admin) =>
  admin
    .use(permissions(PermissionId.ROLES_READ))
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
    ),
)

app.group('', (admin) =>
  admin
    .use(permissions(PermissionId.ROLES_READ))
    .get(
      '/roles/:id',
      async ({ params, status }) => {
        const [role] = await db
          .select()
          .from(roles)
          .where(eq(roles.id, params.id))
          .limit(1)

        if (!role) return status(404, { message: 'Role not found' })

        const rolePerms = await db
          .select({
            id: permissionsSchema.id,
            name: permissionsSchema.name,
            isDefault: roleToPermissions.isDefault,
          })
          .from(roleToPermissions)
          .innerJoin(
            permissionsSchema,
            eq(roleToPermissions.permissionId, permissionsSchema.id),
          )
          .where(eq(roleToPermissions.roleId, params.id))

        const assignedUsers = await db
          .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            picture: users.picture,
          })
          .from(usersToRoles)
          .innerJoin(users, eq(usersToRoles.userId, users.id))
          .where(eq(usersToRoles.roleId, params.id))

        return {
          ...role,
          permissions: rolePerms,
          users: assignedUsers,
        }
      },
      {
        params: t.Object({ id: t.String() }),
        detail: { tags: ['Users'] },
      },
    ),
)

app.group('', (admin) =>
  admin
    .use(permissions(PermissionId.ROLES_CREATE))
    .post(
      '/roles',
      async ({ body, status }) => {
        if (body.permissions?.length) {
          const existingPerms = await db
            .select({ id: permissionsSchema.id })
            .from(permissionsSchema)
            .where(inArray(permissionsSchema.id, body.permissions))
          if (existingPerms.length !== body.permissions.length) {
            return status(400, { message: 'One or more permission IDs are invalid' })
          }
        }

        const id = generateId()
        const [newRole] = await db
          .insert(roles)
          .values({
            id,
            name: body.name,
            description: body.description ?? '',
            isDefault: false,
          })
          .returning()

        if (body.permissions?.length) {
          await db.insert(roleToPermissions).values(
            body.permissions.map((permId) => ({
              roleId: id,
              permissionId: permId,
              isDefault: false,
            })),
          )
        }

        return newRole
      },
      {
        body: t.Object({
          name: t.String(),
          description: t.Optional(t.String()),
          permissions: t.Optional(t.Array(t.String())),
        }),
        detail: { tags: ['Users'] },
      },
    ),
)

app.group('', (admin) =>
  admin
    .use(permissions(PermissionId.ROLES_WRITE))
    .patch(
      '/roles/:id',
      async ({ params, body, status }) => {
        const [role] = await db
          .select()
          .from(roles)
          .where(eq(roles.id, params.id))
          .limit(1)

        if (!role) return status(404, { message: 'Role not found' })
        if (role.isDefault) {
          return status(403, { message: 'Cannot modify default roles' })
        }

        const [updated] = await db
          .update(roles)
          .set({
            ...(body.name !== undefined && { name: body.name }),
            ...(body.description !== undefined && {
              description: body.description,
            }),
          })
          .where(eq(roles.id, params.id))
          .returning()

        return updated
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          name: t.Optional(t.String()),
          description: t.Optional(t.String()),
        }),
        detail: { tags: ['Users'] },
      },
    ),
)

app.group('', (admin) =>
  admin
    .use(permissions(PermissionId.ROLES_DELETE))
    .delete(
      '/roles/:id',
      async ({ params, status }) => {
        const [role] = await db
          .select()
          .from(roles)
          .where(eq(roles.id, params.id))
          .limit(1)

        if (!role) return status(404, { message: 'Role not found' })
        if (role.isDefault) {
          return status(403, { message: 'Cannot delete default roles' })
        }

        // Check no users are assigned this role
        const [assignedCount] = await db
          .select({ count: count() })
          .from(usersToRoles)
          .where(eq(usersToRoles.roleId, params.id))

        if (assignedCount.count > 0) {
          return status(400, {
            message: 'Cannot delete a role that is assigned to users',
          })
        }

        await db
          .delete(roleToPermissions)
          .where(eq(roleToPermissions.roleId, params.id))
        await db.delete(roles).where(eq(roles.id, params.id))

        return status(204)
      },
      {
        params: t.Object({ id: t.String() }),
        detail: { tags: ['Users'] },
      },
    ),
)

app.group('', (admin) =>
  admin
    .use(permissions(PermissionId.ROLES_WRITE))
    .put(
      '/roles/:id/permissions',
      async ({ params, body, status }) => {
        const [role] = await db
          .select()
          .from(roles)
          .where(eq(roles.id, params.id))
          .limit(1)

        if (!role) return status(404, { message: 'Role not found' })
        if (role.isDefault) {
          return status(403, { message: 'Cannot modify default role permissions' })
        }

        if (body.permissions.length > 0) {
          const existingPerms = await db
            .select({ id: permissionsSchema.id })
            .from(permissionsSchema)
            .where(inArray(permissionsSchema.id, body.permissions))
          if (existingPerms.length !== body.permissions.length) {
            return status(400, { message: 'One or more permission IDs are invalid' })
          }
        }

        await db
          .delete(roleToPermissions)
          .where(eq(roleToPermissions.roleId, params.id))

        if (body.permissions.length > 0) {
          await db.insert(roleToPermissions).values(
            body.permissions.map((permId) => ({
              roleId: params.id,
              permissionId: permId,
              isDefault: false,
            })),
          )
        }

        return { success: true }
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          permissions: t.Array(t.String()),
        }),
        detail: { tags: ['Users'] },
      },
    ),
)

app.group('', (admin) =>
  admin
    .use(permissions(PermissionId.PERMISSIONS_READ))
    .get(
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
    ),
)

app.group('', (admin) =>
  admin
    .use(permissions(PermissionId.PERMISSIONS_READ))
    .get(
      '/permissions/:id',
      async ({ params, status }) => {
        const [perm] = await db
          .select()
          .from(permissionsSchema)
          .where(eq(permissionsSchema.id, params.id))
          .limit(1)

        if (!perm) return status(404, { message: 'Permission not found' })

        const associatedRoles = await db
          .select({
            id: roles.id,
            name: roles.name,
            description: roles.description,
            isDefault: roles.isDefault,
          })
          .from(roleToPermissions)
          .innerJoin(roles, eq(roleToPermissions.roleId, roles.id))
          .where(eq(roleToPermissions.permissionId, params.id))

        return {
          ...perm,
          roles: associatedRoles,
        }
      },
      {
        params: t.Object({ id: t.String() }),
        detail: { tags: ['Users'] },
      },
    ),
)

// --- Single user CRUD ---
app.group('', (admin) =>
  admin
    .use(permissions(PermissionId.USERS_READ))
    .get(
      '/:id',
      async ({ params, status }) => {
        const [userRow] = await db
          .select({
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
            alias: users.alias,
            picture: users.picture,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(eq(users.id, params.id))
          .limit(1)

        if (!userRow) return status(404, { message: 'User not found' })

        const userRoles = await db
          .select({ id: roles.id, name: roles.name, description: roles.description })
          .from(usersToRoles)
          .innerJoin(roles, eq(usersToRoles.roleId, roles.id))
          .where(eq(usersToRoles.userId, params.id))

        const userPermissions = await db
          .selectDistinct({ id: permissionsSchema.id, name: permissionsSchema.name })
          .from(usersToRoles)
          .innerJoin(roleToPermissions, eq(usersToRoles.roleId, roleToPermissions.roleId))
          .innerJoin(permissionsSchema, eq(roleToPermissions.permissionId, permissionsSchema.id))
          .where(eq(usersToRoles.userId, params.id))

        const sessionRows = await db
          .select({ count: count() })
          .from(sessions)
          .where(eq(sessions.userId, params.id))

        return {
          ...userRow,
          roles: userRoles,
          permissions: userPermissions,
          sessionCount: sessionRows[0]?.count ?? 0,
        }
      },
      {
        params: t.Object({ id: t.String() }),
        detail: { tags: ['Users'] },
      },
    ),
)

// Separate billing endpoint so user detail loads instantly while billing
// data (which hits the Polar API) streams in independently.
app.group('', (admin) =>
  admin
    .use(permissions(PermissionId.USERS_READ))
    .get(
      '/:id/billing',
      async ({ params, status }) => {
        if (!billing.enabled) {
          return status(404, { message: 'Billing not enabled' })
        }
        const billingInfo = await getAdminUserSubscriptionInfo(params.id)
        return billingInfo ?? { subscription: null, orders: [], portalUrl: null }
      },
      {
        params: t.Object({ id: t.String() }),
        detail: { tags: ['Users'] },
      },
    ),
)

app.group('', (admin) =>
  admin
    .use(permissions(PermissionId.USERS_UPDATE))
    .patch(
      '/:id',
      async ({ params, body, status }) => {
        const [existing] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, params.id))
          .limit(1)

        if (!existing) return status(404, { message: 'User not found' })

        // Validate roles upfront, before the transaction
        if (body.roles) {
          const existingRoles = await db
            .select({ id: roles.id })
            .from(roles)
            .where(inArray(roles.id, body.roles))

          if (existingRoles.length !== body.roles.length) {
            return status(400, { message: 'One or more role IDs are invalid' })
          }
        }

        // Atomic transaction: field updates + role changes together
        await db.transaction(async (tx) => {
          await tx
            .update(users)
            .set({
              ...(body.firstName !== undefined && { firstName: body.firstName }),
              ...(body.lastName !== undefined && { lastName: body.lastName }),
              ...(body.email !== undefined && { email: body.email }),
            })
            .where(eq(users.id, params.id))

          if (body.roles) {
            // Protect last admin: if removing admin role, verify another admin exists
            const currentRoles = await tx
              .select({ roleId: usersToRoles.roleId })
              .from(usersToRoles)
              .where(eq(usersToRoles.userId, params.id))

            const hadAdmin = currentRoles.some(r => r.roleId === 'admin')
            const willHaveAdmin = body.roles.includes('admin')

            if (hadAdmin && !willHaveAdmin) {
              const [adminCount] = await tx
                .select({ count: count() })
                .from(usersToRoles)
                .where(
                  and(
                    eq(usersToRoles.roleId, 'admin'),
                    ne(usersToRoles.userId, params.id),
                  ),
                )

              if (adminCount.count === 0) {
                throw new Error('Cannot remove the last admin')
              }
            }

            await tx.delete(usersToRoles).where(eq(usersToRoles.userId, params.id))
            if (body.roles.length > 0) {
              await tx.insert(usersToRoles).values(
                body.roles.map(roleId => ({ userId: params.id, roleId })),
              )
            }
          }
        })

        const [updated] = await db
          .select()
          .from(users)
          .where(eq(users.id, params.id))
          .limit(1)

        const updatedRoles = await db
          .select({ id: roles.id, name: roles.name })
          .from(usersToRoles)
          .innerJoin(roles, eq(usersToRoles.roleId, roles.id))
          .where(eq(usersToRoles.userId, params.id))

        return { ...updated, roles: updatedRoles }
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          firstName: t.Optional(t.String()),
          lastName: t.Optional(t.String()),
          email: t.Optional(t.String({ format: 'email' })),
          roles: t.Optional(t.Array(t.String())),
        }),
        detail: { tags: ['Users'] },
      },
    ),
)

app.group('', (admin) =>
  admin
    .use(permissions(PermissionId.USERS_DELETE))
    .delete(
      '/:id',
      async ({ params, user, status }) => {
        if (params.id === user.id) {
          return status(400, { message: 'Cannot delete yourself' })
        }

        const [existing] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, params.id))
          .limit(1)

        if (!existing) return status(404, { message: 'User not found' })

        // Protect last admin
        const [isAdmin] = await db
          .select({ count: count() })
          .from(usersToRoles)
          .where(
            and(
              eq(usersToRoles.userId, params.id),
              eq(usersToRoles.roleId, 'admin'),
            ),
          )

        if (isAdmin.count > 0) {
          const [otherAdmins] = await db
            .select({ count: count() })
            .from(usersToRoles)
            .where(
              and(
                eq(usersToRoles.roleId, 'admin'),
                ne(usersToRoles.userId, params.id),
              ),
            )

          if (otherAdmins.count === 0) {
            return status(400, { message: 'Cannot delete the last admin' })
          }
        }

        await lucia.invalidateUserSessions(params.id)
        await db.delete(users).where(eq(users.id, params.id))

        return status(204)
      },
      {
        params: t.Object({ id: t.String() }),
        detail: { tags: ['Users'] },
      },
    ),
)

// --- Impersonation (dev only) ---
app.group('', (admin) =>
  admin
    .use(requireAuth)
    .post(
      '/:id/impersonate',
      async ({ params, user, status }) => {
        if (process.env.NODE_ENV === 'production') {
          return status(403, { message: 'Impersonation is not available in production' })
        }

        if (params.id === user.id) {
          return status(400, { message: 'Cannot impersonate yourself' })
        }

        const [target] = await db
          .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            picture: users.picture,
          })
          .from(users)
          .where(eq(users.id, params.id))
          .limit(1)

        if (!target) return status(404, { message: 'User not found' })

        const session = await lucia.createSession(target.id, {})
        logger.warn(
          {
            action: 'impersonate',
            callerId: user.id,
            targetId: target.id,
            sessionId: session.id,
          },
          `User ${user.id} impersonating ${target.id}`,
        )

        return {
          sessionId: session.id,
          user: target,
        }
      },
      {
        params: t.Object({ id: t.String() }),
        detail: { tags: ['Users'] },
      },
    ),
)

/**
 * Reset the current user's encrypted data and federation identity.
 *
 * Last-resort escape hatch when the user has lost their recovery key
 * AND has no working passkey slot AND no other device to transfer
 * from. Wipes everything encrypted under the old seed (collections,
 * personal blobs, wrapped-master-key slots, device-wrap secrets,
 * friend relationships — because old signatures don't verify under
 * new keys) and nulls the federation identity columns so the user
 * can run a fresh setup on the next call to `PUT /users/me/keys`.
 *
 * Requires `confirm: 'erase-all-my-data'` in the body — a deliberate
 * speed-bump against accidental calls.
 */
app.use(requireAuth).post(
  '/me/identity/reset',
  async ({ user, body, status }) => {
    if (body.confirm !== 'erase-all-my-data') {
      return status(400, {
        message:
          'Confirmation required. Pass `{ "confirm": "erase-all-my-data" }`.',
      })
    }
    await resetUserIdentity(user.id)
    return { success: true }
  },
  {
    body: t.Object({
      confirm: t.Literal('erase-all-my-data'),
    }),
    detail: {
      tags: ['Users', 'Federation'],
      description:
        "Last-resort: wipe all of this user's encrypted data and clear " +
        'the federation identity so they can re-run identity setup. ' +
        'Session + passkeys survive; everything encrypted under the old ' +
        'seed is gone. Irreversible.',
    },
  },
)

/**
 * List peer handles that need a RELATIONSHIP_REVOKE sent to them after
 * an identity reset. Populated at reset time by `resetUserIdentity`;
 * drained by the client once new keys are registered (see
 * `/me/revocations/flush`). The list is empty in the normal case.
 */
app.use(requireAuth).get(
  '/me/revocations/pending',
  async ({ user }) => {
    const rows = await listPendingRevocations(user.id)
    return { revocations: rows }
  },
  {
    detail: {
      tags: ['Users', 'Federation'],
      description:
        'List peer handles queued for revocation after an identity reset.',
    },
  },
)

/**
 * Forward a batch of client-signed RELATIONSHIP_REVOKE messages to the
 * matching peers and delete the `pending_revocations` rows for any that
 * deliver successfully. Each item carries the v2 envelope signature,
 * nonce, and timestamp the client produced; the server does not
 * synthesize any of those fields.
 */
app.use(requireAuth).post(
  '/me/revocations/flush',
  async ({ user, body }) => {
    const results = await flushPendingRevocations(user.id, body.items)
    return { results }
  },
  {
    body: t.Object({
      items: t.Array(
        t.Object({
          peerHandle: t.String(),
          signature: t.String(),
          nonce: t.String(),
          timestamp: t.String(),
          messageVersion: t.Optional(t.Number()),
        }),
      ),
    }),
    detail: {
      tags: ['Users', 'Federation'],
      description:
        'Deliver client-signed RELATIONSHIP_REVOKE envelopes to their ' +
        'peers. Rows that deliver are dropped; failures stay queued for ' +
        'retry.',
    },
  },
)

/**
 * Drop a pending revocation without sending. Used when a peer handle
 * is known to be unreachable (the client has already decided the row
 * is permanently orphaned and doesn't want to keep retrying).
 */
app.use(requireAuth).delete(
  '/me/revocations/pending/:peerHandle',
  async ({ user, params: { peerHandle }, status }) => {
    const decoded = decodeURIComponent(peerHandle)
    const deleted = await discardPendingRevocation(user.id, decoded)
    if (!deleted) return status(404, { message: 'No pending revocation' })
    return { success: true }
  },
  {
    params: t.Object({ peerHandle: t.String() }),
    detail: {
      tags: ['Users', 'Federation'],
      description: 'Drop a queued revocation without delivering it.',
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
 * Update current user's display profile (cleartext first/last name).
 */
app.use(requireAuth).patch(
  '/me/profile',
  async ({ user, body, set }) => {
    await updateUserDisplayProfile(user.id, {
      firstName: body.firstName ?? undefined,
      lastName: body.lastName ?? undefined,
    })
    set.status = 200
    return { success: true }
  },
  {
    body: t.Object({
      firstName: t.Optional(t.Union([t.String(), t.Null()])),
      lastName: t.Optional(t.Union([t.String(), t.Null()])),
    }),
    detail: {
      tags: ['Users'],
      description: 'Update current user display profile (first/last name)',
    },
  },
)

/**
 * Read the current master-key version. Clients compare this against the
 * kmVersion on any record they're reading to detect a rotation in progress.
 */
app.use(requireAuth).get(
  '/me/km-version',
  async ({ user, status }) => {
    const v = await getUserKmVersion(user.id)
    if (v === null) return status(404, { message: 'User not found' })
    return { kmVersion: v }
  },
  {
    detail: {
      tags: ['Users', 'KmRotation'],
      description: 'Get current master-key version (Part C.7)',
    },
  },
)

/**
 * Atomic rotation commit. Caller sends the full post-rotation state —
 * new public keys, re-encrypted personal blobs, re-encrypted collection
 * envelopes, re-sealed wrapped-master-key slots — along with
 * `expectedCurrent` (their view of kmVersion). The server applies it
 * all inside one DB transaction gated by a CAS check: if another device
 * rotated first, we reject with 409 and NOTHING is written, leaving
 * the winning device's state intact.
 *
 * This is the correctness fix for the previous race where client-side
 * rotation did sequential PUTs (PUT keys → PUT each blob → POST each
 * slot → CAS advance). If the CAS failed after those PUTs, the server
 * already had the loser's public keys and mixed data.
 */
app.use(requireAuth).post(
  '/me/km-version/commit',
  async ({ user, body, status, t }) => {
    try {
      const nextKmVersion = await commitRotation({
        userId: user.id,
        expectedCurrent: body.expectedCurrent,
        signingKey: body.signingKey,
        encryptionKey: body.encryptionKey,
        blobs: body.blobs,
        collections: body.collections,
        slots: body.slots,
      })
      return { kmVersion: nextKmVersion }
    } catch (err) {
      if (err instanceof RotationConflict) {
        return status(409, { message: err.message })
      }
      throw err
    }
  },
  {
    body: t.Object({
      expectedCurrent: t.Number(),
      signingKey: t.String(),
      encryptionKey: t.String(),
      blobs: t.Optional(
        t.Array(
          t.Object({
            blobType: t.String(),
            encryptedBlob: t.String(),
          }),
        ),
      ),
      collections: t.Optional(
        t.Array(
          t.Object({
            id: t.String(),
            metadataEncrypted: t.String(),
          }),
        ),
      ),
      slots: t.Optional(
        t.Array(
          t.Object({
            credentialId: t.String(),
            wrappedKm: t.String(),
            wrapAlgo: t.Optional(t.String()),
            slotSignature: t.String(),
          }),
        ),
      ),
    }),
    detail: {
      tags: ['Users', 'KmRotation'],
      description:
        'Atomic rotation commit. Applies new public keys, re-encrypted ' +
        'blobs, re-encrypted collection envelopes, and re-sealed slots ' +
        'in a single transaction gated by a CAS on kmVersion. 409 on ' +
        'conflict — nothing is written.',
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
