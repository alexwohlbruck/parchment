/**
 * Per-user PRF salt for WebAuthn PRF extension.
 *
 * Mirrors `web/src/lib/passkey-prf.ts` exactly — same HKDF context, same
 * output — so that the salt passed in `prf.eval.first` during registration
 * and the salt used for recovery assertions match on both sides. That
 * determinism is the whole point: two ceremonies against the same
 * authenticator must produce the same PRF output.
 *
 * Keying the salt to the user id means the same passkey used with
 * different Parchment accounts still produces different PRF outputs
 * (different wrap keys, no cross-account linkage).
 */

import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'

export const PRF_SALT_CONTEXT = 'parchment-prf-salt-v1'

export function derivePrfSalt(userId: string): Uint8Array {
  const ikm = new TextEncoder().encode(userId)
  return hkdf(
    sha256,
    ikm,
    undefined,
    new TextEncoder().encode(PRF_SALT_CONTEXT),
    32,
  )
}

/**
 * Encode bytes as base64url (no padding). This is the shape WebAuthn
 * expects for `extensions.prf.eval.first` when transported via JSON.
 */
export function bytesToBase64url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
