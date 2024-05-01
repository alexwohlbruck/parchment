import { api } from '@/lib/api'
import { useUserStore } from '@/stores/user.store'
import { createSharedComposable } from '@vueuse/core'

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

  return {
    getAuthenticatedUser,
    verifyEmail,
    signIn,
    signOut,
  }
}

export const useAuthService = createSharedComposable(authService)
