import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import {
  checkHasLocalIdentity,
  fetchIdentityFromServer,
  generateNewIdentity,
  completeIdentitySetup,
  importIdentityFromRecoveryKey,
  getLocalIdentity,
  getRecoveryKey,
  updateAlias as updateAliasService,
  clearLocalIdentity,
  needsIdentitySetup,
  needsIdentityImport,
  verifyAndSyncKeys,
  fetchWrappedKeySlots,
  enrollPasskeySlot,
  enrollExistingPasskeyAsSlot,
  unlockSeedWithPasskey,
  resetServerIdentity,
  type Identity,
} from '@/services/identity.service'
import { useAuthService } from '@/services/auth.service'
import { useAuthStore } from '@/stores/auth.store'
import { api } from '@/lib/api'
import type { DerivedKeys } from '@/lib/federation-crypto'
import {
  rotateMasterKey,
  RotationConflictError,
  type RotationPhase,
} from '@/lib/km-rotation'
import { getSeed } from '@/lib/key-storage'

/**
 * True if the given error is a user-cancelled WebAuthn prompt (closed
 * the biometric sheet, hit escape, tapped outside, etc.). Callers
 * should generally *skip* error toasts for this case — the user
 * intentionally backed out and already knows.
 */
function isUserCancellation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'NotAllowedError' || err.name === 'AbortError')
  )
}

/**
 * Map WebAuthn DOMException names to short, plain-English messages.
 * The `Cancelled. Try again.` string is intentionally friendly — if a
 * caller DOES decide to surface it (e.g. inline in a dialog where the
 * user should retry, not as a toast), this is what they show.
 */
function friendlyWebAuthnError(err: unknown): string {
  if (err instanceof Error) {
    if (isUserCancellation(err)) {
      return 'Cancelled. Try again.'
    }
    if (err.name === 'InvalidStateError') {
      return 'This passkey is already added.'
    }
    if (err.name === 'NotSupportedError') {
      return "Your device doesn't support passkeys."
    }
    if (err.name === 'SecurityError') {
      return 'Your browser blocked the prompt.'
    }
    return err.message
  }
  return 'Something went wrong.'
}

export const useIdentityStore = defineStore('identity', () => {
  // State
  const identity = ref<Identity | null>(null)
  const localKeys = ref<DerivedKeys | null>(null)
  const isLoading = ref(false)
  const hasLocalIdentity = ref(false)
  const pendingRecoveryKey = ref<string | null>(null)
  const pendingSeed = ref<Uint8Array | null>(null)
  const pendingKeys = ref<DerivedKeys | null>(null)
  // Set of credentialIds that have a wrapped-K_m recovery slot on the
  // server. The Passkeys UI reads this to decide whether to show "Enable
  // recovery" vs "Recovery enabled" per row.
  const passkeySlotCredentialIds = ref<Set<string>>(new Set())
  const hasAnyPasskeySlot = computed(
    () => passkeySlotCredentialIds.value.size > 0,
  )

  // Bumped every time a passkey is enrolled or promoted to recovery.
  // Components (e.g. Passkeys.vue) that cache the list locally can
  // watch this counter and refetch from the server when it changes —
  // lets an enrollment triggered from elsewhere (setup dialog,
  // recovery offer) show up without a full page reload.
  const passkeyListVersion = ref(0)

  // True when the server advertises different federation public keys
  // than our local seed derives — set by `verifyAndSyncKeys` during
  // init when another device has rotated. Cleared on successful
  // passkey unlock (which replaces the local seed with the post-
  // rotation one). The UI surfaces this via a banner that offers the
  // one-tap resync.
  const isStale = ref(false)

  // Cross-component trigger: incremented by any component that wants
  // IdentitySettings to open its "Rotate keys" dialog (currently
  // Passkeys.vue's post-delete toast). Watching IdentitySettings
  // reacts to the bump and opens the dialog. Replaces a previous
  // `window.dispatchEvent` / `window.addEventListener` bridge.
  const rotateKeysRequestCounter = ref(0)
  function requestRotateKeys() {
    rotateKeysRequestCounter.value += 1
  }

  // Computed
  const handle = computed(() => identity.value?.handle || null)
  const alias = computed(() => {
    if (!identity.value?.handle) return null
    return identity.value.handle.split('@')[0]
  })
  const domain = computed(() => identity.value?.domain || null)
  const isSetupComplete = computed(() => 
    hasLocalIdentity.value && !!identity.value?.signingKey
  )
  const needsSetup = computed(() => 
    !hasLocalIdentity.value || !identity.value?.signingKey
  )
  const needsImport = computed(() => 
    !hasLocalIdentity.value && !!identity.value?.signingKey
  )
  
  // Key accessors for encryption
  const signingPrivateKey = computed(() => localKeys.value?.signing.privateKey || null)
  const signingPublicKey = computed(() => localKeys.value?.signing.publicKey || null)
  const encryptionPrivateKey = computed(() => localKeys.value?.encryption.privateKey || null)
  const encryptionPublicKey = computed(() => localKeys.value?.encryption.publicKey || null)

  /**
   * Initialize identity state
   * Should be called after user authentication
   */
  async function initialize() {
    isLoading.value = true
    try {
      const [hasLocal, serverIdentity] = await Promise.all([
        checkHasLocalIdentity(),
        fetchIdentityFromServer(),
      ])

      hasLocalIdentity.value = hasLocal
      identity.value = serverIdentity

      if (hasLocal) {
        localKeys.value = await getLocalIdentity()

        // Reconcile local ↔ server public keys.
        //   - 'registered': server had null keys, we filled them → refresh identity
        //   - 'stale': server has DIFFERENT keys (rotation from another
        //     device). Flag it so the UI can offer a one-tap passkey
        //     resync. Do NOT overwrite the server's new keys.
        const outcome = await verifyAndSyncKeys()
        if (outcome === 'registered') {
          identity.value = await fetchIdentityFromServer()
        }
        isStale.value = outcome === 'stale'
      } else {
        isStale.value = false
      }
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Start the identity setup flow
   * Generates new seed and keys, returns recovery key for user to save
   */
  async function startSetup(): Promise<string> {
    const { seed, keys, recoveryKey } = await generateNewIdentity()
    
    pendingSeed.value = seed
    pendingKeys.value = keys
    pendingRecoveryKey.value = recoveryKey
    
    return recoveryKey
  }

  /**
   * Complete setup after user confirms they've saved recovery key
   */
  async function completeSetup(): Promise<{ success: boolean; error?: string }> {
    if (!pendingSeed.value || !pendingKeys.value) {
      return { success: false, error: 'No pending setup' }
    }

    try {
      await completeIdentitySetup(pendingSeed.value, pendingKeys.value)
      
      hasLocalIdentity.value = true
      localKeys.value = pendingKeys.value
      
      // Refresh server identity
      identity.value = await fetchIdentityFromServer()
      
      // Clear pending state
      pendingSeed.value = null
      pendingKeys.value = null
      pendingRecoveryKey.value = null
      
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Setup failed',
      }
    }
  }

  /**
   * Cancel pending setup
   */
  function cancelSetup() {
    pendingSeed.value = null
    pendingKeys.value = null
    pendingRecoveryKey.value = null
  }

  /**
   * Import identity from recovery key
   */
  async function importFromRecoveryKey(
    recoveryKey: string,
  ): Promise<{ success: boolean; error?: string }> {
    isLoading.value = true
    try {
      const result = await importIdentityFromRecoveryKey(recoveryKey)
      
      if (result.success) {
        hasLocalIdentity.value = true
        localKeys.value = await getLocalIdentity()
        identity.value = await fetchIdentityFromServer()
      }
      
      return result
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Get the recovery key for display
   */
  async function fetchRecoveryKey(): Promise<string | null> {
    return getRecoveryKey()
  }

  /**
   * Update alias
   */
  async function updateAlias(
    newAlias: string,
  ): Promise<{ success: boolean; error?: string }> {
    const result = await updateAliasService(newAlias)
    
    if (result.success && result.handle) {
      identity.value = {
        ...identity.value!,
        handle: result.handle,
      }
    }
    
    return result
  }

  /**
   * Last-resort reset when the user has lost their recovery key AND has
   * no working passkey slot AND no other signed-in device to transfer
   * from. Wipes all seed-encrypted data on the server, clears the local
   * seed, and resets store state so the Friends / Settings screens route
   * the user back through identity setup on the next visit.
   *
   * This is the only path short of "make a new account" when every
   * other recovery tier has failed. Irreversible.
   */
  async function resetIdentity(): Promise<{
    success: boolean
    error?: string
  }> {
    isLoading.value = true
    try {
      const serverResult = await resetServerIdentity()
      if (!serverResult.success) {
        return { success: false, error: serverResult.error }
      }
      await clearLocalIdentity()
      identity.value = null
      localKeys.value = null
      hasLocalIdentity.value = false
      pendingSeed.value = null
      pendingKeys.value = null
      pendingRecoveryKey.value = null
      passkeySlotCredentialIds.value = new Set()
      return { success: true }
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Clear identity on logout
   */
  async function clear() {
    await clearLocalIdentity()
    identity.value = null
    localKeys.value = null
    hasLocalIdentity.value = false
    pendingSeed.value = null
    pendingKeys.value = null
    pendingRecoveryKey.value = null
    passkeySlotCredentialIds.value = new Set()
    isStale.value = false
  }

  /**
   * Refresh the passkey recovery slot set from the server. Cheap — one
   * authenticated GET. Called after sign-in (to choose passkey-unlock vs
   * typed-key in the import flow) and from the Passkeys settings list
   * (to label each row as "Recovery enabled" / "Enable recovery").
   */
  async function refreshSlotAvailability() {
    try {
      const slots = await fetchWrappedKeySlots()
      passkeySlotCredentialIds.value = new Set(
        slots.map((s) => s.credentialId),
      )
    } catch {
      passkeySlotCredentialIds.value = new Set()
    }
  }

  /**
   * Enroll a new passkey and, if the authenticator supports PRF, build +
   * upload a wrapped-K_m slot for it. Works in two contexts:
   *
   *   - **Initial setup**: pendingSeed + pendingKeys exist, seed not yet
   *     stored. We enroll the slot using the pending material and then
   *     keep the pending material around so `completeSetup()` can still
   *     persist the seed locally.
   *
   *   - **Settings**: local seed + keys already exist. Derive from
   *     storage.
   */
  async function enrollPasskey(
    passkeyName: string,
    options?: { onSecondTapNeeded?: () => void },
  ): Promise<{
    success: boolean
    slotCreated: boolean
    /** True when the outer WebAuthn ceremony was aborted by the user
     *  (hit cancel on the biometric prompt). Separated from generic
     *  errors so callers can skip the "something went wrong" toast
     *  for a deliberate cancel. */
    cancelled?: boolean
    error?: string
  }> {
    const authStore = useAuthStore()
    const authService = useAuthService()
    const userId = authStore.me?.id
    if (!userId) {
      return { success: false, slotCreated: false, error: 'Not signed in' }
    }

    // Prefer pending setup material if we're mid-setup, otherwise derive
    // from local storage.
    let seed = pendingSeed.value
    let keys: DerivedKeys | null = pendingKeys.value
    if (!seed || !keys) {
      const loadedKeys = await getLocalIdentity()
      if (!loadedKeys) {
        return {
          success: false,
          slotCreated: false,
          error: 'Set up your identity first.',
        }
      }
      keys = loadedKeys
      // We need the raw seed to wrap; re-read from storage.
      const { getSeed } = await import('@/lib/key-storage')
      const loaded = await getSeed()
      if (!loaded) {
        return {
          success: false,
          slotCreated: false,
          error: 'Set up your identity first.',
        }
      }
      seed = loaded
    }

    try {
      const result = await enrollPasskeySlot({
        passkeyName,
        seed,
        keys,
        userId,
        registerPasskey: authService.registerPasskey,
        assertExistingPasskeyForPrf: authService.assertExistingPasskeyForPrf,
        onSecondTapNeeded: options?.onSecondTapNeeded,
      })
      if (result.slotCreated) {
        passkeySlotCredentialIds.value = new Set([
          ...passkeySlotCredentialIds.value,
          result.passkeyId,
        ])
      }
      // Tell any cached passkey list (e.g. Settings → Passkeys) that
      // the list just changed, regardless of whether a slot got
      // created — the credential itself now exists server-side.
      passkeyListVersion.value++
      return {
        success: true,
        slotCreated: result.slotCreated,
        error:
          result.reason === 'prf-unavailable'
            ? "Added, but this passkey can't be used for account recovery."
            : result.reason === 'enroll-failed'
              ? "Added, but recovery didn't save. Try again from Settings."
              : undefined,
      }
    } catch (err) {
      return {
        success: false,
        slotCreated: false,
        cancelled: isUserCancellation(err),
        error: friendlyWebAuthnError(err),
      }
    }
  }

  /**
   * Light up recovery on a passkey the user already owns (e.g. one that
   * was registered for sign-in only, before PRF was requested, or before
   * the Passkey settings surface offered recovery enrollment). Triggers
   * a WebAuthn assertion scoped to that one credentialId with the PRF
   * extension set; if the authenticator emits a PRF output we build +
   * POST the slot. Gracefully reports `prf-unavailable` so the UI can
   * suggest "register a fresh passkey instead."
   */
  async function enrollExistingPasskey(credentialId: string): Promise<{
    success: boolean
    slotCreated: boolean
    cancelled?: boolean
    error?: string
  }> {
    const authStore = useAuthStore()
    const authService = useAuthService()
    const userId = authStore.me?.id
    if (!userId) {
      return { success: false, slotCreated: false, error: 'Not signed in' }
    }

    const keys = await getLocalIdentity()
    if (!keys) {
      return {
        success: false,
        slotCreated: false,
        error: 'Set up your identity first.',
      }
    }
    const seed = await getSeed()
    if (!seed) {
      return {
        success: false,
        slotCreated: false,
        error: 'Set up your identity first.',
      }
    }

    try {
      const result = await enrollExistingPasskeyAsSlot({
        credentialId,
        seed,
        keys,
        userId,
        assertExistingPasskeyForPrf: authService.assertExistingPasskeyForPrf,
      })
      if (result.slotCreated) {
        passkeySlotCredentialIds.value = new Set([
          ...passkeySlotCredentialIds.value,
          credentialId,
        ])
        passkeyListVersion.value++
      }
      const error =
        result.reason === 'prf-unavailable'
          ? "This passkey can't be used for recovery. Add a new one instead."
          : result.reason === 'assertion-failed'
            ? 'Cancelled. Try again.'
            : result.reason === 'upload-failed'
              ? "Couldn't save. Try again."
              : undefined
      return {
        success: true,
        slotCreated: result.slotCreated,
        // `assertion-failed` is what the PRF helper reports when the
        // WebAuthn prompt was cancelled. Surface it as a cancellation
        // so the caller can skip the error toast.
        cancelled: result.reason === 'assertion-failed',
        error,
      }
    } catch (err) {
      return {
        success: false,
        slotCreated: false,
        cancelled: isUserCancellation(err),
        error: friendlyWebAuthnError(err),
      }
    }
  }

  /**
   * Trigger a full K_m rotation. Generates a new seed, re-encrypts every
   * personal blob under the new seed's personal key, re-seals each
   * wrapped-K_m slot (prompts one passkey tap per slot), advances
   * `users.kmVersion` via CAS, and finally replaces the locally-stored
   * seed.
   *
   * The `onProgress` callback drives the Settings rotation dialog.
   */
  async function rotateKeys(options?: {
    onProgress?: (phase: RotationPhase) => void
  }): Promise<{
    success: boolean
    error?: string
    conflict?: boolean
    slotResults?: Array<{ credentialId: string; ok: boolean; reason?: string }>
  }> {
    const authStore = useAuthStore()
    const authService = useAuthService()
    const userId = authStore.me?.id
    if (!userId) {
      return { success: false, error: 'Not signed in' }
    }
    const oldSeed = await getSeed()
    if (!oldSeed) {
      return { success: false, error: 'No local seed to rotate' }
    }

    // Fetch current kmVersion for the CAS advance. If the server 404s
    // here something is badly off (user deleted out from under us) —
    // bail with an error rather than guessing a version.
    let currentKmVersion: number
    try {
      const kmResp = await api.get<{ kmVersion: number }>(
        '/users/me/km-version',
      )
      currentKmVersion = kmResp.data.kmVersion
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Could not fetch current key version',
      }
    }

    isLoading.value = true
    try {
      const result = await rotateMasterKey({
        userId,
        oldSeed,
        currentKmVersion,
        assertPasskeyForSlot: authService.assertExistingPasskeyForPrf,
        onProgress: options?.onProgress,
      })

      // Refresh store state with the new keys. Public-key re-registration
      // happened during rotation; just reflect it locally.
      localKeys.value = await getLocalIdentity()
      identity.value = await fetchIdentityFromServer()
      return { success: true, slotResults: result.slotResults }
    } catch (err) {
      if (err instanceof RotationConflictError) {
        return { success: false, conflict: true, error: err.message }
      }
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Rotation failed',
      }
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Recover the seed on a new device by asserting against one of the
   * user's PRF-enabled passkeys. Session must already exist. On success,
   * sets hasLocalIdentity + localKeys and refreshes the server identity.
   */
  async function unlockWithPasskey(): Promise<{
    success: boolean
    cancelled?: boolean
    error?: string
  }> {
    const authService = useAuthService()
    isLoading.value = true
    try {
      await unlockSeedWithPasskey({
        assertPasskeyForPrf: authService.assertPasskeyForPrf,
      })
      hasLocalIdentity.value = true
      localKeys.value = await getLocalIdentity()
      identity.value = await fetchIdentityFromServer()
      // Seed we just stored was unwrapped from the server's current
      // wrapped-master-key slot, whose signature is bound to the
      // server's current signing key. So by definition we're now in
      // sync — clear the stale flag.
      isStale.value = false
      return { success: true }
    } catch (err) {
      return {
        success: false,
        cancelled: isUserCancellation(err),
        error: err instanceof Error ? err.message : 'Unlock failed',
      }
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Called right after a successful passkey sign-in. If the user has
   * wrapped-key slots on the server but no local seed (typical "signed
   * in on a new device" state), automatically run the PRF assertion so
   * their encrypted data is ready the moment they land on the map —
   * no manual "Restore identity" click needed.
   *
   * Returns:
   *   'unlocked'    — seed restored, ready to go
   *   'not-needed'  — local seed already present or no server slots
   *   'cancelled'   — user cancelled the biometric prompt
   *   'failed'      — unlock error (user can retry manually in Settings)
   */
  async function autoUnlockAfterSignIn(): Promise<
    'unlocked' | 'not-needed' | 'cancelled' | 'failed'
  > {
    await initialize()
    if (hasLocalIdentity.value) return 'not-needed'
    await refreshSlotAvailability()
    if (!hasAnyPasskeySlot.value) return 'not-needed'
    const result = await unlockWithPasskey()
    if (result.cancelled) return 'cancelled'
    return result.success ? 'unlocked' : 'failed'
  }

  return {
    // State
    identity,
    localKeys,
    isLoading,
    hasLocalIdentity,
    pendingRecoveryKey,
    hasAnyPasskeySlot,
    passkeySlotCredentialIds,
    passkeyListVersion,
    isStale,
    rotateKeysRequestCounter,
    requestRotateKeys,

    // Computed
    handle,
    alias,
    domain,
    isSetupComplete,
    needsSetup,
    needsImport,
    signingPrivateKey,
    signingPublicKey,
    encryptionPrivateKey,
    encryptionPublicKey,

    // Actions
    initialize,
    startSetup,
    completeSetup,
    cancelSetup,
    importFromRecoveryKey,
    fetchRecoveryKey,
    updateAlias,
    clear,
    refreshSlotAvailability,
    enrollPasskey,
    enrollExistingPasskey,
    unlockWithPasskey,
    autoUnlockAfterSignIn,
    rotateKeys,
    resetIdentity,
  }
})

