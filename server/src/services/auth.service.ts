import { Context } from 'elysia'
import { lucia } from '../lucia'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { appName, origins } from '../config'
import { User } from '../schema/user.schema'
import { Passkey, passkeys } from '../schema/passkey.schema'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
} from '@simplewebauthn/server'
import { AuthenticatorTransportFuture } from '@simplewebauthn/types'
import { sessions } from '../schema/session.schema'
import { sendMail } from './mailer.service'

// Webauthn relaying party information
export const rpName = appName
export const rpID = origins.serverHostname.replace(/:\d+$/, '') // Remove port number

/**
 * Create a new session for a user, sign in
 * @param userId The user's ID
 * @param set Elysia set object
 * @returns Newly created session
 */
export async function createSession(
  userId: User['id'],
  { set, headers }: { set: Context['set']; headers: Context['headers'] },
) {
  const session = await lucia.createSession(userId, {})
  const sessionCookie = lucia.createSessionCookie(session.id)

  set.status = 201
  set.headers = {
    ...set.headers,
    Location: '/',
    'Set-Cookie': sessionCookie.serialize(),
  }

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
