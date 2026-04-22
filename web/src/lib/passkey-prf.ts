/**
 * Passkey-PRF wrapped master-key slots (Part C.6).
 *
 * Flow on enrollment:
 *   1. Trigger WebAuthn registration/authentication with `prf` extension.
 *   2. Server returns the PRF output (32 bytes, keyed by the authenticator).
 *   3. Derive an AES-256 wrap key via HKDF(prfOutput, info="parchment-prf-wrap-v1").
 *   4. Encrypt K_m (the user's seed) under that wrap key with v2 envelope.
 *   5. Sign `(userId || credentialId || wrappedKm || wrapAlgo)` with the
 *      user's long-term Ed25519 identity key.
 *   6. POST the slot to /users/me/wrapped-keys.
 *
 * Flow on sign-in (new device, no local seed):
 *   1. User taps their passkey. WebAuthn returns PRF output.
 *   2. Fetch the slot from /users/me/wrapped-keys.
 *   3. Verify slotSignature against the user's identity pubkey BEFORE using
 *      the wrappedKm. If the server lied, verification fails.
 *   4. HKDF → wrap key → decrypt wrappedKm → recover K_m.
 *
 * The per-user PRF salt (passed as `prf.eval.first`) is derived from the
 * user id: `HKDF(userId_bytes, info="parchment-prf-salt-v1", 32B)`.
 * Keying the salt to the user means the same passkey used with different
 * Parchment accounts produces different PRF outputs.
 */

import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
ed.hashes.sha512 = (...m) => sha512(ed.etc.concatBytes(...m))

import {
  encryptEnvelopeString,
  decryptEnvelopeString,
  type AAD,
} from './crypto-envelope'
import {
  base64ToBytes,
  bytesToBase64,
  buildSignableMessage,
} from './federation-crypto'

export const PRF_SALT_CONTEXT = 'parchment-prf-salt-v2'
export const PRF_WRAP_KEY_CONTEXT = 'parchment-prf-wrap-v1'
export const CURRENT_WRAP_ALGO = 'aes-256-gcm-prf-v1'

/**
 * Constant PRF salt. Same bytes for every user + every credential on
 * this app. Fed to WebAuthn as `prf.eval.first`. The PRF output is
 * still per-credential (the authenticator HMACs with the credential's
 * secret), but the salt is app-constant so the server can include the
 * extension in sign-in options without knowing which user is signing
 * in yet — collapsing sign-in + unwrap into one biometric tap. Salt
 * constancy is fine: WebAuthn credentials are RP-scoped, and slot
 * signatures bind credential → user at the wrap layer.
 */
const PRF_SALT = hkdf(
  sha256,
  new TextEncoder().encode('parchment'),
  undefined,
  new TextEncoder().encode(PRF_SALT_CONTEXT),
  32,
)

export function derivePrfSalt(): Uint8Array {
  return PRF_SALT
}

/**
 * HKDF the raw PRF output into an AES-256 wrap key.
 */
export function deriveWrapKey(prfOutput: Uint8Array): Uint8Array {
  if (prfOutput.length < 16) {
    throw new Error('PRF output too short')
  }
  return hkdf(
    sha256,
    prfOutput,
    undefined,
    new TextEncoder().encode(PRF_WRAP_KEY_CONTEXT),
    32,
  )
}

function wrapAAD(params: {
  userId: string
  credentialId: string
}): AAD {
  return {
    userId: params.userId,
    recordType: 'wrapped-master-key',
    recordId: params.credentialId,
    keyContext: PRF_WRAP_KEY_CONTEXT,
  }
}

function slotSignableString(params: {
  userId: string
  credentialId: string
  wrappedKm: string
  wrapAlgo: string
}): string {
  return buildSignableMessage('wrapped-km-slot', {
    userId: params.userId,
    credentialId: params.credentialId,
    wrappedKm: params.wrappedKm,
    wrapAlgo: params.wrapAlgo,
  })
}

export interface WrappedKmSlot {
  credentialId: string
  wrappedKm: string // base64 v2 envelope
  wrapAlgo: string
  slotSignature: string // base64 Ed25519 signature over canonical fields
}

/**
 * Wrap K_m (seed) under the PRF-derived key and sign the slot with the
 * user's long-term Ed25519 identity key. Returns the complete slot shape
 * ready to POST.
 */
export async function buildWrappedKmSlot(params: {
  seed: Uint8Array
  prfOutput: Uint8Array
  userId: string
  credentialId: string
  identitySigningPrivateKey: Uint8Array
}): Promise<WrappedKmSlot> {
  const wrapKey = deriveWrapKey(params.prfOutput)
  const wrappedKm = encryptEnvelopeString({
    plaintext: bytesToBase64(params.seed),
    key: wrapKey,
    aad: wrapAAD({
      userId: params.userId,
      credentialId: params.credentialId,
    }),
  })

  const canonical = slotSignableString({
    userId: params.userId,
    credentialId: params.credentialId,
    wrappedKm,
    wrapAlgo: CURRENT_WRAP_ALGO,
  })
  const sig = await ed.signAsync(
    new TextEncoder().encode(canonical),
    params.identitySigningPrivateKey,
  )

  return {
    credentialId: params.credentialId,
    wrappedKm,
    wrapAlgo: CURRENT_WRAP_ALGO,
    slotSignature: bytesToBase64(sig),
  }
}

/**
 * Verify a slot's signature against the user's long-term Ed25519 identity
 * public key. Returns true if genuine.
 */
export function verifyWrappedKmSlot(params: {
  slot: WrappedKmSlot
  userId: string
  identitySigningPublicKey: Uint8Array
}): boolean {
  const canonical = slotSignableString({
    userId: params.userId,
    credentialId: params.slot.credentialId,
    wrappedKm: params.slot.wrappedKm,
    wrapAlgo: params.slot.wrapAlgo,
  })
  try {
    return ed.verify(
      base64ToBytes(params.slot.slotSignature),
      new TextEncoder().encode(canonical),
      params.identitySigningPublicKey,
    )
  } catch {
    return false
  }
}

/**
 * Unwrap K_m from a slot. Caller MUST have verified the slot signature
 * first — this function refuses to run if called without a fresh verify.
 */
export function unwrapKmFromSlot(params: {
  slot: WrappedKmSlot
  prfOutput: Uint8Array
  userId: string
  verifiedSignature: true // token-style proof that caller verified
}): Uint8Array {
  if (params.slot.wrapAlgo !== CURRENT_WRAP_ALGO) {
    throw new Error(`Unsupported wrap algorithm ${params.slot.wrapAlgo}`)
  }
  if (params.verifiedSignature !== true) {
    throw new Error('Slot signature must be verified before unwrap')
  }
  const wrapKey = deriveWrapKey(params.prfOutput)
  const seedBase64 = decryptEnvelopeString({
    envelope: params.slot.wrappedKm,
    key: wrapKey,
    aad: wrapAAD({
      userId: params.userId,
      credentialId: params.slot.credentialId,
    }),
  })
  const seed = base64ToBytes(seedBase64)
  if (seed.length !== 32) {
    throw new Error(`Unwrapped seed has wrong length: ${seed.length}`)
  }
  return seed
}
