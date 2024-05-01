import { ref } from 'vue'
import { api } from '@/lib/api'
import { useUserStore } from '@/stores/user.store'
import { createSharedComposable } from '@vueuse/core'

function authService() {
  const userStore = useUserStore()

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

    const user = response.data?.user

    if (user) {
      userStore.setAuthenticatedUser(user)
    } else {
      userStore.unsetAuthenticatedUser()
    }

    return response
  }

  return {
    verifyEmail,
    signIn,
  }
}

export const useAuthService = createSharedComposable(authService)
