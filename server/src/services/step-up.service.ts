import { and, eq } from 'drizzle-orm'
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/types'
import { db } from '../db'
import { origins } from '../config'
import { passkeys } from '../schema/passkeys.schema'
import { users } from '../schema/users.schema'
import type { Language } from '../lib/i18n/i18n.types'
import { rpID, sendEmailVerificationCode } from './auth.service'
import { createServerToken, validateServerToken } from './token.service'

export type StepUpChallenge =
  | { method: 'passkey'; options: PublicKeyCredentialRequestOptionsJSON }
  | { method: 'email' }

export interface StepUpProof {
  passkey?: AuthenticationResponseJSON
  code?: string
}

function transportsOf(raw: string): AuthenticatorTransportFuture[] {
  return raw.split(',').filter(Boolean) as AuthenticatorTransportFuture[]
}

/**
 * Ask the signed-in user to prove it's them again: a passkey assertion when
 * they have one, otherwise (or when asked) an emailed one-time code.
 */
export async function beginStepUp(
  userId: string,
  opts: { preferEmail?: boolean; language?: Language } = {},
): Promise<StepUpChallenge> {
  const owned = await db
    .select({ id: passkeys.id, transports: passkeys.transports })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))

  if (owned.length > 0 && !opts.preferEmail) {
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: owned.map((p) => ({
        id: p.id,
        transports: transportsOf(p.transports),
      })),
      userVerification: 'required',
    })
    return { method: 'passkey', options }
  }

  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
  if (!user) throw new Error('User not found')
  const code = await createServerToken('otp', userId)
  await sendEmailVerificationCode(user.email, code, userId, opts.language)
  return { method: 'email' }
}

/** True when the proof shows the caller just re-authenticated as `userId`. */
export async function verifyStepUp(
  userId: string,
  proof: StepUpProof,
  expectedChallenge: string | undefined,
): Promise<boolean> {
  if (proof.code) {
    return (await validateServerToken(proof.code, 'otp', userId)) === 'valid'
  }
  if (!proof.passkey || !expectedChallenge) return false

  const [passkey] = await db
    .select()
    .from(passkeys)
    .where(and(eq(passkeys.id, proof.passkey.id), eq(passkeys.userId, userId)))
  if (!passkey) return false

  try {
    const verification = await verifyAuthenticationResponse({
      response: proof.passkey,
      expectedChallenge,
      expectedOrigin: origins.clientOrigin ?? '',
      expectedRPID: rpID,
      requireUserVerification: true,
      authenticator: {
        credentialID: passkey.id,
        credentialPublicKey: Buffer.from(passkey.publicKey, 'base64'),
        counter: passkey.counter,
        transports: transportsOf(passkey.transports),
      },
    })
    if (!verification.verified) return false
    await db
      .update(passkeys)
      .set({ counter: verification.authenticationInfo.newCounter })
      .where(eq(passkeys.id, passkey.id))
    return true
  } catch {
    return false
  }
}
