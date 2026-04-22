import { api, isTauri } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useAppService } from '@/services/app.service'
import { useIntegrationService } from '@/services/integration.service'
import { clearAllUserCaches } from '@/services/cache.service'
import { syncPreferencesFromBackend } from '@/services/preferences.service'
import { createSharedComposable } from '@vueuse/core'
import { startRegistration, startAuthentication } from '@simplewebauthn/browser'
import {
  hydratePrfExtensionInPlace,
  extractPrfOutputFromAssertion,
} from '@/lib/passkey-prf-support'
import { Session } from '@/types/session.types'
import { PermissionId, PermissionRule, User } from '@/types/auth.types'
import { auth as deviceStore } from '@/lib/device-store'
import { i18n } from '@/lib/i18n'

function setAuthHeader(token: string | null) {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`
  } else {
    delete api.defaults.headers.common['Authorization']
  }
}

function authService() {
  const authStore = useAuthStore()
  const integrationService = useIntegrationService()

  async function loadToken() {
    if (isTauri) {
      const token = await deviceStore.getToken()
      if (token) {
        authStore.setAuthToken(token)
        setAuthHeader(token)
      }
      return token
    }
  }

  async function getPermissions() {
    const {
      data: { permissions },
    } = await api.get('auth/sessions/current/permissions')
    authStore.setPermissions(permissions)
  }

  async function getAuthenticatedUser() {
    const localAuthToken = await loadToken()
    const hasCachedUser = authStore.me !== undefined && authStore.me !== null

    const sessionPromise = api.get('auth/sessions/current')
    // Resolve to no user on timeout/network error so router guard doesn't wait forever
    const authenticatedUserPromise = sessionPromise.catch(() => {
      authStore.updateUser(null)
      return { data: { user: null, token: null } }
    })

    // If we have cached user, set a resolved promise so router guards don't block
    // The actual server request will validate/update in background
    if (hasCachedUser) {
      authStore.setAuthenticatedUserPromise(Promise.resolve({ data: { user: authStore.me } }))

      // Validate session in background - update store when response arrives
      sessionPromise
        .then(response => {
          const { user, token: sessionId } = response?.data ?? {}
          if (user) {
            authStore.updateUser(user)
            setAuthHeader(sessionId)
            getPermissions()
          } else {
            clearAllUserCaches()
            authStore.unsetAuthenticatedUser()
          }
        })
        .catch(() => {
          clearAllUserCaches()
          authStore.unsetAuthenticatedUser()
        })

      return { user: authStore.me }
    }

    // No cache - wait for server response (or timeout → no user)
    authStore.setAuthenticatedUserPromise(authenticatedUserPromise)

    const response = await authenticatedUserPromise
    const { user, token: sessionId } = response?.data ?? {}

    if (user) {
      setAuthenticatedUser(user, sessionId)
    }
    return { user }
  }

  async function setAuthenticatedUser(user: User, sessionId: Session['id']) {
    // Set auth header first so integration fetches are authenticated
    setAuthHeader(sessionId)

    // Fetch integrations and preferences before navigating to the map
    await Promise.all([
      integrationService.fetchAvailableIntegrations(),
      integrationService.fetchConfiguredIntegrations(),
      syncPreferencesFromBackend(),
    ])

    // Now navigate to the map (authStore.setAuthenticatedUser triggers navigation)
    authStore.setAuthenticatedUser(user, sessionId)
    getPermissions()
  }

  async function verifyEmail(email: string) {
    return api.post('auth/verify', { email })
  }

  async function signIn(email: string, token: string) {
    const response = await api.post('auth/sessions', {
      method: 'otp',
      email,
      token,
    })

    const {
      data: { user, token: sessionId },
    } = response

    if (isTauri) {
      await deviceStore.setToken(sessionId)
    }

    setAuthenticatedUser(user, sessionId)
    return response
  }

  async function signOut() {
    const response = await api.delete('auth/sessions')
    if (isTauri) {
      await deviceStore.clearToken()
    }
    setAuthHeader(null)

    // Clear all cached user data + the wrapped seed envelope and
    // device-id in localStorage. Without this, the next user to sign
    // in on the same browser would see the previous user's seed:
    // everything would decrypt with the wrong personal key and the
    // stale-device banner would trigger on every session.
    clearAllUserCaches()
    const identityStore = useIdentityStore()
    await identityStore.clear()

    authStore.unsetAuthenticatedUser()
    return response
  }

  /**
   * Prompt the user to confirm, then sign out if they agree. Shared by
   * every user-facing sign-out entry point (account menu, settings
   * page, command palette) so the dialog copy stays consistent and a
   * stray click never logs someone out mid-task.
   */
  async function confirmAndSignOut() {
    const appService = useAppService()
    // Cast avoids vue-i18n's "excessively deep" inference on the
    // global typed schema — this call site is fine at runtime.
    const t = (i18n.global as unknown as { t: (key: string) => string }).t
    const confirmed = await appService.confirm({
      title: t('palette.commands.signOut.confirmTitle'),
      description: t('palette.commands.signOut.confirmDescription'),
      destructive: true,
      continueText: t('palette.commands.signOut.name'),
    })
    if (!confirmed) return
    await signOut()
  }

  async function registerPasskey(name: string) {
    const { data: options } = await api.post(`auth/passkeys/register/options`)

    // Server includes `extensions.prf.eval.first` as a base64url string.
    // simplewebauthn-browser v10 doesn't convert extension binary fields,
    // so Chrome would reject a string where it expects a BufferSource.
    // Convert in place first.
    hydratePrfExtensionInPlace(options)

    // If the ceremony throws (user cancelled, duplicate credential,
    // unsupported browser, malformed options) we MUST abort before
    // POSTing verify — posting a body without the attestation response
    // gives a misleading 422. Rethrow so the caller can surface it.
    const attestationResponse = await startRegistration(options)

    const { data: passkey } = await api.post(`auth/passkeys/register/verify`, {
      ...attestationResponse,
      name,
    })

    return { passkey, attestationResponse }
  }

  /**
   * Request a PRF-enabled authentication ceremony and return the raw
   * assertion response. Caller extracts the PRF output from
   * `clientExtensionResults.prf.results.first`. Session must already
   * exist (the endpoint is authenticated).
   *
   * NOTE on `hydratePrfExtensionInPlace`: simplewebauthn-browser v10
   * doesn't recurse into `extensions.prf.eval` to convert base64url →
   * ArrayBuffer the way it does for `challenge`, so we do it ourselves
   * before dispatching the ceremony; otherwise Chrome rejects the
   * malformed input and the user sees a "cancelled" error.
   */
  async function assertPasskeyForPrf() {
    const { data: options } = await api.post('auth/passkeys/prf-assert/options')
    hydratePrfExtensionInPlace(options)
    const assertionResponse = await startAuthentication(options, false)
    return assertionResponse
  }

  /**
   * Same as `assertPasskeyForPrf`, but scoped to a specific credentialId
   * the user already owns. Used to light up PRF-based recovery on a
   * pre-existing passkey without registering a new one.
   */
  async function assertExistingPasskeyForPrf(credentialId: string) {
    const { data: options } = await api.post(
      `auth/passkeys/${encodeURIComponent(credentialId)}/prf-enroll/options`,
    )
    hydratePrfExtensionInPlace(options)
    const assertionResponse = await startAuthentication(options, false)
    return assertionResponse
  }

  async function signInWithPasskey(eager: boolean) {
    const { data: options } = await api.post(
      `auth/passkeys/authenticate/options`,
    )
    // Server now includes the PRF extension in sign-in options (see
    // `generateWebauthnOptions('authenticate')`). simplewebauthn-browser
    // v10 doesn't hydrate extension base64url fields; do it before
    // startAuthentication so Chrome accepts the BufferSource.
    hydratePrfExtensionInPlace(options)

    let attestationResponse
    try {
      attestationResponse = await startAuthentication(options, eager)
    } catch (error) {
      // TODO
      throw error
    }

    const {
      data: { user, token: sessionId },
    } = await api.post(
      `/auth/passkeys/authenticate/verify`,
      attestationResponse,
    )

    if (user) {
      await setAuthenticatedUser(user, sessionId)
      // Pull the PRF output off the same assertion we just used to
      // sign in. Capable authenticators (iCloud Keychain, Chrome 132+,
      // modern Android) return it in-band — one biometric covers both
      // sign-in AND seed unwrap. When missing, autoUnlockAfterSignIn
      // falls back to a fresh PRF assertion (two-tap path).
      const prfOutput = extractPrfOutputFromAssertion(
        attestationResponse as {
          clientExtensionResults?: {
            prf?: {
              results?: {
                first?: ArrayBuffer | ArrayBufferView | string
              }
            }
          }
        },
      )
      const prefetched = prfOutput
        ? { credentialId: attestationResponse.id, prfOutput }
        : undefined
      void autoUnlockAfterSignIn(prefetched)
    }
  }

  /**
   * Background restore after a passkey sign-in. Prompts the user's
   * biometric a second time via the PRF ceremony and unwraps the
   * server's slot into a local seed. The user sees a muted info toast
   * explaining why the second prompt is happening.
   */
  async function autoUnlockAfterSignIn(
    prefetched?: { credentialId: string; prfOutput: Uint8Array },
  ) {
    // Imports are dynamic to avoid circular init between auth and
    // identity stores (identity store calls useAuthService()).
    const { useIdentityStore } = await import('@/stores/identity.store')
    const { toast } = await import('vue-sonner')
    const { i18n: i18nInstance } = await import('@/lib/i18n')
    // Cast to dodge vue-i18n's "excessively deep" inference for the
    // typed schema.
    const t = (i18nInstance.global as unknown as { t: (key: string) => string })
      .t

    const identityStore = useIdentityStore()

    // Only show the "tap again" heads-up when we actually need a
    // second biometric (no PRF came back in the sign-in assertion).
    // With the fast path (in-band PRF), sign-in and unwrap collapse
    // into one ceremony — no toast spam, no second prompt.
    const needsSecondTap = !prefetched
    let heads: string | number | undefined
    if (needsSecondTap) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      heads = toast.info(t('auth.passkey.restoringTitle'), {
        description: t('auth.passkey.restoringDescription'),
        duration: 12000,
      })
    }

    try {
      const result = await identityStore.autoUnlockAfterSignIn(prefetched)
      if (heads !== undefined) toast.dismiss(heads)
      if (result === 'unlocked' && needsSecondTap) {
        // Only toast success when we'd previously bothered the user
        // with a second prompt — otherwise the unwrap is invisible.
        toast.success(t('auth.passkey.restoredSuccess'))
      }
      if (result === 'failed') {
        toast.warning(t('auth.passkey.restoreFailed'))
      }
      // 'not-needed' and 'cancelled' fall through silently.
    } catch {
      if (heads !== undefined) toast.dismiss(heads)
      // Swallow — manual restore in Settings is always available.
    }
  }

  async function getPasskeys() {
    const { data: passkeys } = await api.get(`/auth/passkeys`)
    return passkeys
  }

  async function deletePasskey(passkeyId: string) {
    await api.delete(`/auth/passkeys/${passkeyId}`)
  }

  async function getSessions(): Promise<Session> {
    const { data: sessions } = await api.get(`/auth/sessions`)
    authStore.setSessions(sessions)
    return sessions
  }

  async function deleteSession(sessionId: Session['id']) {
    await api.delete(`/auth/sessions/${sessionId}`)
    authStore.removeSession(sessionId)
  }

  /**
   * Sign out of every other device. Sends the current deviceId so the
   * server can exempt it from the wrap-secret rotation — otherwise the
   * caller's own seed envelope would fail AEAD on next open and
   * require a re-unlock.
   */
  async function signOutOtherDevices() {
    const { getOrCreateDeviceId } = await import('@/lib/device-id')
    const deviceId = getOrCreateDeviceId()
    await api.delete('/auth/sessions/others', { data: { deviceId } })
  }

  /**
   * Take a permissions rule object and determine if user has permission
   */
  function hasPermission(rule: PermissionRule) {
    if (typeof rule === 'string') {
      return hasAllPermissions(rule)
    } else {
      if (rule.all && hasAllPermissions(rule.all)) {
        return true
      }
      if (rule.any && hasAnyPermission(rule.any)) {
        return true
      }
      return false
    }
  }

  /**
   * Check user has all permissions required. Can pass a single permission ID or a list
   */
  function hasAllPermissions(permissions: PermissionId | PermissionId[]) {
    const userPermissions = authStore.permissions

    const hasPermission = Array.isArray(permissions)
      ? permissions.every(permission => userPermissions.includes(permission))
      : userPermissions.includes(permissions)

    return hasPermission
  }

  /**
   * Check if a user has any of a given list of permission IDs
   */
  function hasAnyPermission(permissions: PermissionId[]) {
    const userPermissions = authStore.permissions
    return permissions.some(value => userPermissions.includes(value))
  }

  return {
    loadToken,
    getAuthenticatedUser,
    getPermissions,
    verifyEmail,
    signIn,
    signOut,
    confirmAndSignOut,
    registerPasskey,
    assertPasskeyForPrf,
    assertExistingPasskeyForPrf,
    signInWithPasskey,
    getPasskeys,
    deletePasskey,
    getSessions,
    deleteSession,
    signOutOtherDevices,
    hasPermission,
    hasAllPermissions,
    hasAnyPermission,
  }
}

export const useAuthService = createSharedComposable(authService)
