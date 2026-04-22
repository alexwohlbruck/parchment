/**
 * Identity Service
 * 
 * Manages the federation identity lifecycle:
 * - First-time setup (generate seed, derive keys, register with server)
 * - Recovery key display and copy
 * - Import recovery key on new device
 * - Get current identity for signing requests
 */

import { api } from '@/lib/api'
import {
  generateSeed,
  deriveAllKeys,
  exportRecoveryKey,
  importRecoveryKey,
  exportPublicKey,
  importPublicKey,
  sign,
  buildSignableMessage,
  type DerivedKeys,
} from '@/lib/federation-crypto'
import {
  storeSeed,
  getSeed,
  hasIdentity,
  clearIdentity,
} from '@/lib/key-storage'
import {
  buildWrappedKmSlot,
  unwrapKmFromSlot,
  verifyWrappedKmSlot,
  type WrappedKmSlot,
} from '@/lib/passkey-prf'
import {
  extractPrfOutputFromAssertion,
  extractPrfOutputFromRegistration,
  registrationHasPrfEnabled,
} from '@/lib/passkey-prf-support'

export interface Identity {
  handle: string | null
  signingKey: string | null
  encryptionKey: string | null
  domain: string
}

export interface IdentityWithKeys extends Identity {
  keys: DerivedKeys
  recoveryKey: string
}

/**
 * Check if the user has a local identity (seed stored)
 */
export async function checkHasLocalIdentity(): Promise<boolean> {
  return hasIdentity()
}

/**
 * Get the current identity from the server
 */
export async function fetchIdentityFromServer(): Promise<Identity | null> {
  try {
    const response = await api.get<Identity>('/users/me/identity')
    return response.data
  } catch {
    return null
  }
}

/**
 * Generate a new identity (seed and derived keys)
 * Does NOT register with server yet - user must confirm recovery key first
 */
export async function generateNewIdentity(): Promise<{
  seed: Uint8Array
  keys: DerivedKeys
  recoveryKey: string
}> {
  const seed = generateSeed()
  const keys = deriveAllKeys(seed)
  const recoveryKey = exportRecoveryKey(seed)
  
  return { seed, keys, recoveryKey }
}

/**
 * Complete identity setup after user confirms recovery key
 * Stores seed locally and registers public keys with server
 */
export async function completeIdentitySetup(
  seed: Uint8Array,
  keys: DerivedKeys,
): Promise<void> {
  // Store seed in IndexedDB
  await storeSeed(seed)
  
  // Register public keys with server
  await api.put('/users/me/keys', {
    signingKey: exportPublicKey(keys.signing.publicKey),
    encryptionKey: exportPublicKey(keys.encryption.publicKey),
  })
}

/**
 * Import identity from recovery key
 * Used when logging in on a new device
 */
export async function importIdentityFromRecoveryKey(
  recoveryKey: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const seed = importRecoveryKey(recoveryKey)
    const keys = deriveAllKeys(seed)
    
    // Get server identity to verify
    const serverIdentity = await fetchIdentityFromServer()
    
    if (serverIdentity?.signingKey) {
      // Verify the imported key matches server
      const derivedSigningKey = exportPublicKey(keys.signing.publicKey)
      if (derivedSigningKey !== serverIdentity.signingKey) {
        return {
          success: false,
          error: 'Recovery key does not match your account',
        }
      }
    }
    
    // Store the seed
    await storeSeed(seed)
    
    // If server doesn't have keys yet, register them
    if (!serverIdentity?.signingKey) {
      await api.put('/users/me/keys', {
        signingKey: exportPublicKey(keys.signing.publicKey),
        encryptionKey: exportPublicKey(keys.encryption.publicKey),
      })
    }
    
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Invalid recovery key',
    }
  }
}

/**
 * Get the current local identity with keys
 * Returns null if no identity is stored locally
 */
export async function getLocalIdentity(): Promise<DerivedKeys | null> {
  const seed = await getSeed()
  if (!seed) return null
  
  return deriveAllKeys(seed)
}

/**
 * Get the recovery key for the current identity
 * Used to display in settings
 */
export async function getRecoveryKey(): Promise<string | null> {
  const seed = await getSeed()
  if (!seed) return null
  
  return exportRecoveryKey(seed)
}

/**
 * Sign a federation message
 */
export async function signFederationMessage(
  type: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const keys = await getLocalIdentity()
  if (!keys) {
    throw new Error('No identity found. Please set up your federation identity.')
  }
  
  const message = buildSignableMessage(type, payload)
  return sign(message, keys.signing.privateKey)
}

/**
 * Update the user's alias
 */
export async function updateAlias(alias: string): Promise<{
  success: boolean
  handle?: string
  error?: string
}> {
  try {
    const response = await api.patch<{ alias: string; handle: string }>(
      '/users/me/alias',
      { alias },
    )
    return {
      success: true,
      handle: response.data.handle,
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.message || 'Failed to update alias',
    }
  }
}

/**
 * Clear local identity (for logout or reset)
 */
export async function clearLocalIdentity(): Promise<void> {
  await clearIdentity()
}

/**
 * Server-side reset of the user's federation identity + all seed-
 * encrypted data. Called only as a last resort when the user has lost
 * every path back to their seed. Server returns 400 unless the
 * `confirm` literal is included — speed-bump against accidental calls.
 */
export async function resetServerIdentity(): Promise<{
  success: boolean
  error?: string
}> {
  try {
    await api.post('/users/me/identity/reset', {
      confirm: 'erase-all-my-data',
    })
    return { success: true }
  } catch (err: unknown) {
    const message =
      (err as { response?: { data?: { message?: string } }; message?: string })
        ?.response?.data?.message ??
      (err instanceof Error ? err.message : 'Reset failed')
    return { success: false, error: message }
  }
}

/**
 * Check if identity setup is needed
 * Returns true if user has no local identity or server has no keys
 */
export async function needsIdentitySetup(): Promise<boolean> {
  const [hasLocal, serverIdentity] = await Promise.all([
    hasIdentity(),
    fetchIdentityFromServer(),
  ])
  
  // Needs setup if:
  // - No local identity, OR
  // - Server has no signing key
  return !hasLocal || !serverIdentity?.signingKey
}

/**
 * Check if user needs to import their identity on this device
 * (Server has keys but local doesn't)
 */
export async function needsIdentityImport(): Promise<boolean> {
  const [hasLocal, serverIdentity] = await Promise.all([
    hasIdentity(),
    fetchIdentityFromServer(),
  ])
  
  return !hasLocal && !!serverIdentity?.signingKey
}

/**
 * List the user's existing passkey-PRF wrapped K_m slots on the server.
 * Each slot corresponds to one passkey that can unwrap the seed on this
 * (or any) device. Requires an authenticated session.
 */
export async function fetchWrappedKeySlots(): Promise<WrappedKmSlot[]> {
  try {
    const response = await api.get<{ slots: WrappedKmSlot[] }>(
      '/users/me/wrapped-keys',
    )
    return response.data.slots ?? []
  } catch {
    return []
  }
}

export async function hasAnyWrappedKeySlot(): Promise<boolean> {
  const slots = await fetchWrappedKeySlots()
  return slots.length > 0
}

/**
 * Enroll a passkey AND build+upload a wrapped-K_m slot for it.
 *
 * Fast path (SINGLE biometric tap) — supported by iCloud Keychain,
 * Chrome 132+ macOS, Chrome 147+ Windows, modern Android platform
 * authenticators:
 *   1. Registration with `extensions.prf.eval.first = <salt>`. The
 *      authenticator evaluates PRF in-band and returns the output on
 *      the creation response. Done.
 *
 * Slow path (TWO taps) — older FIDO2 security keys or platforms that
 * can enable PRF on the credential but can't evaluate in-band:
 *   1. Registration as above. Response says `prf.enabled: true` but
 *      no `results.first`.
 *   2. Follow-up assertion scoped to the just-registered credential,
 *      which triggers a second biometric. Caller gets notified via
 *      `onSecondTapNeeded` so it can show an explanatory toast.
 *
 * If the authenticator doesn't set `prf.enabled: true`, the credential
 * is not PRF-capable (rare on modern authenticators). Return
 * `{ reason: 'prf-unavailable' }`; passkey is registered sign-in-only.
 */
export async function enrollPasskeySlot(params: {
  passkeyName: string
  seed: Uint8Array
  keys: DerivedKeys
  userId: string
  registerPasskey: (name: string) => Promise<{
    passkey: { id: string }
    attestationResponse: unknown
  }>
  assertExistingPasskeyForPrf: (credentialId: string) => Promise<unknown>
  /**
   * Fired between the first and second ceremony if a follow-up
   * assertion is needed. UI can show a toast/alert so the user
   * understands why they're being prompted again.
   */
  onSecondTapNeeded?: () => void
}): Promise<{
  slotCreated: boolean
  passkeyId: string
  reason?: 'prf-unavailable' | 'enroll-failed'
  secondTapUsed?: boolean
}> {
  const { passkey, attestationResponse } = await params.registerPasskey(
    params.passkeyName,
  )

  const regResponse = attestationResponse as {
    clientExtensionResults?: {
      prf?: {
        enabled?: boolean
        results?: {
          first?: ArrayBuffer | ArrayBufferView | string
        }
      }
    }
  }

  // Fast path: PRF output came back in-band.
  let prfOutput: Uint8Array | null = extractPrfOutputFromRegistration(
    regResponse,
  )
  let secondTapUsed = false

  // Slow path: credential is PRF-capable but the authenticator didn't
  // evaluate in-band. Do a separate assertion.
  if (!prfOutput && registrationHasPrfEnabled(regResponse)) {
    params.onSecondTapNeeded?.()
    secondTapUsed = true
    try {
      const assertion = await params.assertExistingPasskeyForPrf(passkey.id)
      prfOutput = extractPrfOutputFromAssertion(
        assertion as {
          clientExtensionResults?: {
            prf?: {
              results?: {
                first?: ArrayBuffer | ArrayBufferView | string
              }
            }
          }
        },
      )
    } catch {
      // User cancelled the second tap or the ceremony errored. The
      // passkey is still registered — treat as sign-in-only.
    }
  }

  if (!prfOutput) {
    return {
      slotCreated: false,
      passkeyId: passkey.id,
      reason: 'prf-unavailable',
      secondTapUsed,
    }
  }

  try {
    const slot = await buildWrappedKmSlot({
      seed: params.seed,
      prfOutput,
      userId: params.userId,
      credentialId: passkey.id,
      identitySigningPrivateKey: params.keys.signing.privateKey,
    })

    await api.post('/users/me/wrapped-keys', {
      credentialId: slot.credentialId,
      wrappedKm: slot.wrappedKm,
      wrapAlgo: slot.wrapAlgo,
      slotSignature: slot.slotSignature,
    })

    return { slotCreated: true, passkeyId: passkey.id, secondTapUsed }
  } catch {
    return {
      slotCreated: false,
      passkeyId: passkey.id,
      reason: 'enroll-failed',
      secondTapUsed,
    }
  }
}

/**
 * Enable recovery on a passkey that was registered BEFORE the user had a
 * recovery slot (either pre-dates the PRF feature or was registered
 * sign-in-only). The user taps the existing passkey; if the authenticator
 * emits a PRF output, we build + POST a slot for it. If PRF isn't
 * supported by that credential, we report so the UI can suggest
 * registering a fresh passkey instead.
 *
 * Takes no seed argument — caller provides everything via the existing
 * identity store state (mirrors `enrollPasskeySlot`).
 */
export async function enrollExistingPasskeyAsSlot(params: {
  credentialId: string
  seed: Uint8Array
  keys: DerivedKeys
  userId: string
  assertExistingPasskeyForPrf: (credentialId: string) => Promise<unknown>
}): Promise<{
  slotCreated: boolean
  reason?: 'prf-unavailable' | 'assertion-failed' | 'upload-failed'
}> {
  let assertion: unknown
  try {
    assertion = await params.assertExistingPasskeyForPrf(params.credentialId)
  } catch {
    return { slotCreated: false, reason: 'assertion-failed' }
  }

  const prfOutput = extractPrfOutputFromAssertion(
    assertion as {
      clientExtensionResults?: { prf?: { results?: { first?: string } } }
    },
  )
  if (!prfOutput) {
    return { slotCreated: false, reason: 'prf-unavailable' }
  }

  try {
    const slot = await buildWrappedKmSlot({
      seed: params.seed,
      prfOutput,
      userId: params.userId,
      credentialId: params.credentialId,
      identitySigningPrivateKey: params.keys.signing.privateKey,
    })
    await api.post('/users/me/wrapped-keys', {
      credentialId: slot.credentialId,
      wrappedKm: slot.wrappedKm,
      wrapAlgo: slot.wrapAlgo,
      slotSignature: slot.slotSignature,
    })
    return { slotCreated: true }
  } catch {
    return { slotCreated: false, reason: 'upload-failed' }
  }
}

/**
 * Recover the seed on a new device by asserting against one of the
 * user's PRF-enabled passkeys. Caller must already be signed in (OTP
 * or a plain passkey auth) so the session exists and the server knows
 * which user's salt + slot list to return.
 *
 * Returns the seed on success. Throws with a specific reason on failure
 * so the caller can route to the typed-recovery-key fallback with an
 * accurate error message.
 */
export async function unlockSeedWithPasskey(params: {
  assertPasskeyForPrf: () => Promise<unknown>
}): Promise<Uint8Array> {
  const serverIdentity = await fetchIdentityFromServer()
  if (!serverIdentity?.signingKey) {
    throw new Error('No federation identity on server to recover against')
  }
  const slots = await fetchWrappedKeySlots()
  if (slots.length === 0) {
    throw new Error('No passkey recovery slots available for this account')
  }

  const assertion = (await params.assertPasskeyForPrf()) as {
    id: string
    clientExtensionResults?: {
      prf?: {
        results?: {
          first?: ArrayBuffer | ArrayBufferView | string
        }
      }
    }
  }
  const prfOutput = extractPrfOutputFromAssertion(assertion)
  if (!prfOutput) {
    throw new Error(
      "This passkey doesn't support PRF, or your browser didn't return " +
        'a PRF output. Try a different passkey or use your recovery key.',
    )
  }

  // The tapped passkey's id is on the assertion; match it to a slot.
  const slot = slots.find((s) => s.credentialId === assertion.id)
  if (!slot) {
    throw new Error(
      'The passkey you tapped has no recovery slot. Use a different ' +
        'passkey or fall back to the recovery key.',
    )
  }

  const serverSigningPubKey = importPublicKey(serverIdentity.signingKey)
  // We need the userId to verify and unwrap. The server identity handle
  // embeds it indirectly; we fetch the authenticated user's id via the
  // session endpoint. Reuse the existing auth.sessions/current call —
  // cheapest and already wired.
  const sessionResponse = await api.get<{ user: { id: string } }>(
    'auth/sessions/current',
  )
  const userId = sessionResponse.data.user.id

  const signatureOk = verifyWrappedKmSlot({
    slot,
    userId,
    identitySigningPublicKey: serverSigningPubKey,
  })
  if (!signatureOk) {
    throw new Error(
      'Recovery slot failed signature verification — the server may have ' +
        'tampered with the slot. Refusing to unwrap.',
    )
  }

  const seed = unwrapKmFromSlot({
    slot,
    prfOutput,
    userId,
    verifiedSignature: true,
  })

  // Confirm the unwrapped seed actually matches the server's advertised
  // identity before storing — guards against the extremely unlikely case
  // where signature+unwrap both happen to succeed under wrong key.
  const derived = deriveAllKeys(seed)
  if (exportPublicKey(derived.signing.publicKey) !== serverIdentity.signingKey) {
    throw new Error(
      'Unwrapped seed does not match server identity. Refusing to store.',
    )
  }

  await storeSeed(seed)

  // Best-effort: mark the slot as used. Don't block recovery on it.
  api.post(`/users/me/wrapped-keys/${slot.credentialId}/used`).catch(() => {})

  return seed
}

/**
 * Reconcile local seed-derived public keys with what the server has
 * published for this user. Three possible outcomes:
 *
 *   - `matched`: local and server keys agree. No action.
 *   - `registered`: the server had NO keys (fresh account, first-time
 *     setup). We registered ours.
 *   - `stale`: the server has DIFFERENT keys than our local seed
 *     derives. Almost always means keys were rotated from another
 *     device. We must NOT PUT our local keys back — that would
 *     overwrite the post-rotation keys and strand the other device's
 *     re-encrypted data. Caller surfaces this so the user can tap a
 *     passkey to unwrap the new seed on this device via
 *     `unlockWithPasskey`.
 */
export type VerifyKeysOutcome = 'matched' | 'registered' | 'stale' | 'unknown'

export async function verifyAndSyncKeys(): Promise<VerifyKeysOutcome> {
  const localKeys = await getLocalIdentity()
  if (!localKeys) return 'unknown'

  const serverIdentity = await fetchIdentityFromServer()
  if (!serverIdentity) return 'unknown'

  const localSigningKey = exportPublicKey(localKeys.signing.publicKey)
  const localEncryptionKey = exportPublicKey(localKeys.encryption.publicKey)

  const signingMatch = localSigningKey === serverIdentity.signingKey
  const encryptionMatch = localEncryptionKey === serverIdentity.encryptionKey

  if (signingMatch && encryptionMatch) return 'matched'

  // Server has NO keys yet → first-time setup for this account.
  // Registering ours is safe because there's nothing to overwrite.
  if (!serverIdentity.signingKey || !serverIdentity.encryptionKey) {
    try {
      await api.put('/users/me/keys', {
        signingKey: localSigningKey,
        encryptionKey: localEncryptionKey,
      })
      return 'registered'
    } catch (error) {
      console.error('Failed to register keys:', error)
      return 'unknown'
    }
  }

  // Server has DIFFERENT keys → rotation happened elsewhere. NEVER
  // PUT our local keys here; doing so would undo the rotation and
  // break the other device's newly re-encrypted data. Flag stale.
  return 'stale'
}
