import { api } from '@/lib/api'
import { useUserStore } from '@/stores/user.store'
import { createSharedComposable } from '@vueuse/core'
import { startRegistration, startAuthentication } from '@simplewebauthn/browser'

// TODO: Return types

function authService() {
  const userStore = useUserStore()

  async function getAuthenticatedUser() {
    const response = await api.get('users/me')
    const user = response.data || null
    userStore.setAuthenticatedUser(user)
    return response
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

    const user = response.data?.user || null
    userStore.setAuthenticatedUser(user)

    return response
  }

  async function signOut() {
    const response = await api.delete('auth/sessions')
    userStore.unsetAuthenticatedUser()

    return response
  }

  async function registerPasskey() {
    const { data: options } = await api.post(`auth/webauthn/register/options`)

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

    const { data: passkey } = await api.post(
      `auth/webauthn/register/verify`,
      attestationResponse,
    )

    return passkey
  }

  async function signInWithPasskey(eager: boolean) {
    const { data: options } = await api.post(
      `auth/webauthn/authenticate/options`,
    )

    let attestationResponse
    try {
      attestationResponse = await startAuthentication(options, eager)
    } catch (error) {
      // TODO
      throw error
    }

    const {
      data: { user },
    } = await api.post(
      `/auth/webauthn/authenticate/verify`,
      attestationResponse,
    )

    if (user) {
      userStore.setAuthenticatedUser(user)
    }
  }

  return {
    getAuthenticatedUser,
    verifyEmail,
    signIn,
    signOut,
    registerPasskey,
    signInWithPasskey,
  }
}

export const useAuthService = createSharedComposable(authService)
