import { Context } from 'elysia'
import { lucia } from '../lucia'
import { eq, and, ne } from 'drizzle-orm'
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
import { rotateAllForUser } from './device-wrap-secrets.service'
import { derivePrfSalt, bytesToBase64url } from '../lib/passkey-prf'
import { wrappedMasterKeys } from '../schema/wrapped-master-keys.schema'

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
 * Sign out of every device: destroy every session row owned by this user,
 * then rotate every per-device wrap secret so any seed envelope cached in
 * `localStorage` on any of the user's devices fails AEAD on next open
 * and is forced back through the unlock flow.
 *
 * Order matters: delete sessions first so in-flight tabs can no longer
 * refetch the new wrap secret with their old auth, then rotate.
 */
export async function destroyAllSessions(userId: User['id']) {
  await db.delete(sessions).where(eq(sessions.userId, userId))
  await rotateAllForUser(userId)
}

/**
 * Sign out of every device EXCEPT the one making the request. Deletes
 * every other session row and rotates every other device's wrap secret,
 * while leaving the current session + current device's wrap secret
 * intact so the caller doesn't lose access to its own identity.
 *
 * `currentSessionId` comes from the authenticated session; the client
 * tells us its `deviceId` so we can exempt its wrap secret from the
 * rotation (wrap secrets are keyed by deviceId, not sessionId).
 */
export async function destroyOtherSessions(
  userId: User['id'],
  currentSessionId: string,
  currentDeviceId: string,
) {
  await db
    .delete(sessions)
    .where(
      and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId)),
    )
  await rotateAllForUser(userId, { excludeDeviceId: currentDeviceId })
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
 * Create an webauthn-compliant options object to register or authenticate a passkey.
 *
 * Registration declares the WebAuthn `prf` extension with an EMPTY
 * object — no `eval`. This is the canonical reliable pattern:
 *
 *   create → extensions.prf = {}       (just "please enable PRF")
 *   get    → extensions.prf.eval.first = <salt>   (actually evaluate)
 *
 * Including `prf.eval` during create causes authenticators that can't
 * evaluate in-band (Chrome ≤146 + Windows Hello, older Chrome + Touch
 * ID, some FIDO2 keys) to silently drop the entire PRF extension,
 * leaving the resulting credential PRF-disabled forever. We learned
 * this the hard way — see the Feb 2026 incident notes in the passkey
 * handoff doc. The eval always happens in a follow-up assertion
 * request built by `generatePrfEnrollOptionsForCredential` /
 * `generatePrfAssertionOptions` below.
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

      const regOptions = await generateRegistrationOptions({
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

      // Ask the authenticator to BOTH enable PRF on the new credential
      // AND evaluate it in-band with the per-user salt. Capable
      // authenticators (iCloud Keychain, Chrome 132+ on macOS, Chrome
      // 147+ on Windows) return the PRF output in the registration
      // response — single biometric tap end-to-end. Less capable ones
      // set `prf.enabled = true` without emitting output, and the
      // client does a follow-up assertion. The key guarantee from the
      // spec: if the authenticator processes the extension at all,
      // `prf.enabled` is a reliable signal that PRF-on-get will work.
      return {
        ...regOptions,
        extensions: {
          ...(regOptions.extensions ?? {}),
          prf: {
            eval: {
              first: bytesToBase64url(derivePrfSalt(userId)),
            },
          },
        },
      }
    case 'authenticate':
      return await generateAuthenticationOptions({
        rpID,
      })
  }
}

/**
 * PRF-enabled authentication options bound to ONE specific passkey the
 * user owns. Used when the user wants to *enable recovery* on an already-
 * registered passkey: the client triggers this ceremony, extracts the
 * PRF output, and posts a new wrapped-K_m slot. Returns 404 if the
 * credentialId doesn't belong to the caller.
 */
export async function generatePrfEnrollOptionsForCredential(
  userId: User['id'],
  credentialId: string,
) {
  const row = await db
    .select({
      id: passkeys.id,
      transports: passkeys.transports,
    })
    .from(passkeys)
    .where(and(eq(passkeys.userId, userId), eq(passkeys.id, credentialId)))
    .limit(1)
  if (!row[0]) return null

  const allowCredentials = [
    {
      id: row[0].id,
      transports: row[0].transports.split(
        ',',
      ) as AuthenticatorTransportFuture[],
    },
  ]

  const baseOptions = await generateAuthenticationOptions({
    rpID,
    allowCredentials,
    userVerification: 'required',
  })

  return {
    ...baseOptions,
    extensions: {
      ...(baseOptions.extensions ?? {}),
      prf: {
        eval: {
          first: bytesToBase64url(derivePrfSalt(userId)),
        },
      },
    },
  }
}

/**
 * PRF-enabled authentication options for recovering a seed on a new
 * device. Caller MUST be authenticated (so we know which user's salt to
 * use and which credentials to allow). Restricts `allowCredentials` to
 * the user's passkeys that have wrapped-master-key slots — any other
 * passkey can't unwrap and would just waste a tap.
 */
export async function generatePrfAssertionOptions(userId: User['id']) {
  const rows = await db
    .select({
      id: passkeys.id,
      transports: passkeys.transports,
    })
    .from(passkeys)
    .innerJoin(wrappedMasterKeys, eq(wrappedMasterKeys.credentialId, passkeys.id))
    .where(eq(passkeys.userId, userId))

  const allowCredentials = rows.map((row) => ({
    id: row.id,
    transports: row.transports.split(
      ',',
    ) as AuthenticatorTransportFuture[],
  }))

  const baseOptions = await generateAuthenticationOptions({
    rpID,
    allowCredentials,
    userVerification: 'required',
  })

  return {
    ...baseOptions,
    extensions: {
      ...(baseOptions.extensions ?? {}),
      prf: {
        eval: {
          first: bytesToBase64url(derivePrfSalt(userId)),
        },
      },
    },
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
