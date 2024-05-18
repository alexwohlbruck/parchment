import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { createSharedComposable } from '@vueuse/core'
import { startRegistration, startAuthentication } from '@simplewebauthn/browser'
import { Session } from '@/types/session.types'

// TODO: Return types

function authService() {
  const authStore = useAuthStore()

  async function getAuthenticatedUser() {
    const {
      data: { user, token: sessionId },
    } = await api.get('auth/sessions/current')
    authStore.setAuthenticatedUser(user, sessionId)
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

  async function getSessions() {
    const { data: sessions } = await api.get(`/auth/sessions`)
    return sessions
  }

  async function deleteSession(sessionId: Session['id']) {
    await api.delete(`/auth/sessions/${sessionId}`)
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
  }
}

export const useAuthService = createSharedComposable(authService)
