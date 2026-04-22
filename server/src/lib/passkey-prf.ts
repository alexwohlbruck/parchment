/**
 * Constant PRF salt for the WebAuthn PRF extension.
 *
 * Mirrors `web/src/lib/passkey-prf.ts` exactly — same HKDF context, same
 * output — so that the salt passed in `prf.eval.first` during registration
 * and the salt used for recovery assertions match on both sides. That
 * determinism is the whole point: two ceremonies against the same
 * authenticator must produce the same PRF output.
 *
 * Why constant (not per-user): pre-auth sign-in options can't know the
 * user id yet (discoverable-credential flow), so a per-user salt would
 * force two biometric prompts to unwrap on sign-in. A constant salt
 * lets the server include the PRF extension in every options endpoint
 * without user context, collapsing sign-in + unwrap into one tap.
 *
 * WebAuthn credentials are already scoped to the Relying Party Domain;
 * per-user salts only matter if an attacker observes multiple PRF
 * outputs across accounts, which is outside our threat model (an
 * attacker able to observe raw PRF outputs has already lost the game
 * at an earlier layer). Slot signatures still bind credential → user,
 * so the wrap key can't be misused across accounts.
 */

import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'

export const PRF_SALT_CONTEXT = 'parchment-prf-salt-v2'

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
 * Encode bytes as base64url (no padding). This is the shape WebAuthn
 * expects for `extensions.prf.eval.first` when transported via JSON.
 */
export function bytesToBase64url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
