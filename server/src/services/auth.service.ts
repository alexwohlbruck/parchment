import { Context } from 'elysia'
import { lucia } from '../lucia'
import { eq, and } from 'drizzle-orm'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
} from '@simplewebauthn/server'
import { db } from '../db'
import { appName, origins } from '../config'
import { User } from '../schema/users.schema'
import { Passkey, passkeys } from '../schema/passkeys.schema'
import { usersToRoles } from '../schema/users-roles.schema'
import { Permission, permissions } from '../schema/permissions.schema'
import { PermissionRule } from '../types/auth.types'
import { roleToPermissions } from '../schema/roles-permissions.schema'
import { AuthenticatorTransportFuture } from '@simplewebauthn/types'
import { sessions } from '../schema/sessions.schema'
import { sendMail } from './mailer.service'
import { roles } from '../schema/roles.schema'

// Webauthn relaying party information
export const rpName = appName
export const rpID = origins.clientHostname.replace(/:\d+$/, '') // Remove port number

/**
 * Create a new session for a user, sign in
 * @param userId The user's ID
 * @param context Request context
 * @returns Newly created session
 */
export async function createSession(
  userId: User['id'],
  { set, headers }: { set: Context['set']; headers: Context['headers'] },
) {
  const session = await lucia.createSession(userId, {})

  // Check if client wants cookie auth
  const wantsCookie = !headers['authorization']
  if (wantsCookie) {
    const sessionCookie = lucia.createSessionCookie(session.id)
    set.cookie = {
      auth_session: {
        value: sessionCookie.value,
        ...sessionCookie.attributes,
      },
    }
  }

  set.status = 201

  // TODO: Set ip address
  await db
    .update(sessions)
    .set({
      userAgent: headers ? headers['user-agent'] || '' : '',
    })
    .where(eq(sessions.id, session.id))
    .returning()

  return session
}

/**
 * Destroy a user session and sign out
 * @param set Elysia set object
 * @returns Newly created session
 */
export async function destroySession(cookie: Context['cookie']) {
  const sessionCookie = cookie['auth_session']
  await db.delete(sessions).where(eq(sessions.id, sessionCookie.value))
  sessionCookie.path = '/'
  sessionCookie.remove()
}

/**
 * Send a one-time verification code to a user's email inbox
 * @param email Email address of the user
 * @param code Code to send
 * @returns Whether email was successfully sent
 */
export async function sendEmailVerificationCode(email: string, code: string) {
  console.log(email, code)
  await sendMail({
    to: email,
    from: 'onboarding',
    subject: 'Parchment Email Verification',
    template: 'verificationCode',
    data: {
      code,
    },
  })
  return true
}

/**
 * Create an webauthn-compliant options object to register or authenticate a passkey
 */
export async function generateWebauthnOptions(
  method: 'register' | 'authenticate',
  userId?: string,
  userName?: string,
) {
  switch (method) {
    case 'register':
      if (!userId || !userName)
        throw new Error(
          'User ID and username required for passkey registration.',
        )

      const existingPasskeys = (
        await db.select().from(passkeys).where(eq(passkeys.userId, userId))
      ).map((passkey: Passkey) => ({
        id: passkey.id,
        transports: passkey.transports.split(
          ',',
        ) as AuthenticatorTransportFuture[],
      }))

      return await generateRegistrationOptions({
        rpID,
        rpName,
        userName,
        attestationType: 'none',
        excludeCredentials: existingPasskeys,
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
      })
    case 'authenticate':
      return await generateAuthenticationOptions({
        rpID,
      })
  }
}

export async function getPermissions(userId: User['id']) {
  // TODO: Optimize this query for Redis caching
  const result = await db
    .select()
    .from(usersToRoles)
    .where(eq(usersToRoles.userId, userId))
    .innerJoin(
      roleToPermissions,
      eq(usersToRoles.roleId, roleToPermissions.roleId),
    )
    .innerJoin(permissions, eq(roleToPermissions.permissionId, permissions.id))

  return result.map(({ permissions }) => permissions.id)
}

export function hasPermission(
  userPermissions: Permission['id'][],
  rule: PermissionRule,
) {
  if (typeof rule === 'string') {
    return hasAllPermissions(userPermissions, rule)
  } else {
    if (rule.all && hasAllPermissions(userPermissions, rule.all)) {
      return true
    }
    if (rule.any && hasAnyPermission(userPermissions, rule.any)) {
      return true
    }
    return false
  }
}

/**
 * Check user has all permissions required. Can pass a single permission ID or a list
 */
function hasAllPermissions(
  userPermissions: Permission['id'][],
  requiredPermissions: Permission['id'] | Permission['id'][],
) {
  const hasPermission = Array.isArray(requiredPermissions)
    ? requiredPermissions.every((permission) =>
        userPermissions.includes(permission),
      )
    : userPermissions.includes(requiredPermissions)

  return hasPermission
}

/**
 * Check if a user has any of a given list of permission IDs
 */
function hasAnyPermission(
  userPermissions: Permission['id'][],
  requiredPermissions: Permission['id'][],
) {
  return requiredPermissions.some((value) => userPermissions.includes(value))
}

export async function getRoles(userId: User['id']) {
  const result = await db
    .select()
    .from(usersToRoles)
    .where(eq(usersToRoles.userId, userId))
    .innerJoin(roles, eq(usersToRoles.roleId, roles.id))

  return result.map(({ role }) => role)
}
