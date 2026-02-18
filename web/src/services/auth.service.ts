import { api, isTauri } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { useIntegrationService } from '@/services/integration.service'
import { clearAllUserCaches } from '@/services/cache.service'
import { syncPreferencesFromBackend } from '@/services/preferences.service'
import { createSharedComposable } from '@vueuse/core'
import { startRegistration, startAuthentication } from '@simplewebauthn/browser'
import { Session } from '@/types/session.types'
import { PermissionId, PermissionRule, User } from '@/types/auth.types'
import { auth as deviceStore } from '@/lib/device-store'

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
    
    const authenticatedUserPromise = api.get('auth/sessions/current')
    
    // If we have cached user, set a resolved promise so router guards don't block
    // The actual server request will validate/update in background
    if (hasCachedUser) {
      authStore.setAuthenticatedUserPromise(Promise.resolve({ data: { user: authStore.me } }))
      
      // Validate session in background - update store when response arrives
      authenticatedUserPromise.then(response => {
        const { user, token: sessionId } = response?.data ?? {}
        if (user) {
          authStore.updateUser(user)
          setAuthHeader(sessionId)
          getPermissions()
        } else {
          // Session invalid - clear caches and redirect
          clearAllUserCaches()
          authStore.unsetAuthenticatedUser()
        }
      }).catch(() => {
        // On error, session might be invalid
        clearAllUserCaches()
        authStore.unsetAuthenticatedUser()
      })
      
      return { user: authStore.me }
    }
    
    // No cache - wait for server response
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
    
    // Clear all cached user data
    clearAllUserCaches()
    
    authStore.unsetAuthenticatedUser()
    return response
  }

  async function registerPasskey(name: string) {
    const { data: options } = await api.post(`auth/passkeys/register/options`)

    let attestationResponse
    try {
      attestationResponse = await startRegistration(options)
    } catch (error: any) {
      console.error(error)
      if (error.name === 'InvalidStateError') {
        // TODO:
      } else {
        // TODO: Generic error
      }
    }

    const { data: passkey } = await api.post(`auth/passkeys/register/verify`, {
      ...attestationResponse,
      name,
    })

    return passkey
  }

  async function signInWithPasskey(eager: boolean) {
    const { data: options } = await api.post(
      `auth/passkeys/authenticate/options`,
    )

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
      setAuthenticatedUser(user, sessionId)
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
    registerPasskey,
    signInWithPasskey,
    getPasskeys,
    deletePasskey,
    getSessions,
    deleteSession,
    hasPermission,
    hasAllPermissions,
    hasAnyPermission,
  }
}

export const useAuthService = createSharedComposable(authService)
