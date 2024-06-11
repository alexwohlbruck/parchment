import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { createSharedComposable } from '@vueuse/core'
import { startRegistration, startAuthentication } from '@simplewebauthn/browser'
import { Session } from '@/types/session.types'
import { PermissionId, PermissionRule } from '@/types/auth.types'

// TODO: Return types

function authService() {
  const authStore = useAuthStore()

  async function getAuthenticatedUser() {
    const authenticatedUserPromise = api.get('auth/sessions/current')
    authStore.setAuthenticatedUserPromise(authenticatedUserPromise)
    const {
      data: { user, token: sessionId, permissions },
    } = await authenticatedUserPromise
    if (user) {
      authStore.setAuthenticatedUser(user, sessionId)
      authStore.setPermissions(permissions)
    } else {
      authStore.unsetAuthenticatedUser()
    }
    return {
      user,
    }
  }

  async function verifyEmail(email: string) {
    return api.post('auth/verify', { email })
  }

  async function signIn(email: string, token: string) {
    const response = await api.post(
      'auth/sessions',
      {
        method: 'otp',
        email,
        token,
      },
      {
        withCredentials: true,
      },
    )

    const {
      data: { user, token: sessionId },
    } = response
    authStore.setAuthenticatedUser(user, sessionId)
    return response
  }

  async function signOut() {
    const response = await api.delete('auth/sessions')
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
      authStore.setAuthenticatedUser(user, sessionId)
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
    getAuthenticatedUser,
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
