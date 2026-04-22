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
import { buildHandle, getServerDomain } from '../services/federation.service'
import { isValidAlias } from '../lib/crypto'

import { i18next } from 'elysia-i18next'
import { detectLanguage, getI18nInitOptions } from '../lib/i18n'

const app = new Elysia({ prefix: '/users' })

// TODO: Make permission names type safe
app.use(permissions(PermissionId.USERS_READ)).get(
  '/',
  async () => {
    const usersResult = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        alias: users.alias,
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
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        picture: body.picture,
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
