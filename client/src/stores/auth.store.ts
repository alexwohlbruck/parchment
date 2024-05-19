import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { defineStore } from 'pinia'
import { User } from '@/types/auth.types'
import { Session } from '@/types/session.types'

export const useAuthStore = defineStore('user', () => {
  const router = useRouter()

  const me = ref<User | null | undefined>()
  const sessionId = ref<Session['id'] | null>(null)
  const attemptedPath = ref<string | null>(null)
  const authenticatedUserPromise = ref<Promise<any>>()

  /**
   * Save path the user has visited on page load.
   * If signed out, we restore this path upon sign in
   */
  function stashPath(path: string) {
    attemptedPath.value = path
  }

  function setAuthenticatedUser(user: User, _sessionId: Session['id']) {
    me.value = user
    sessionId.value = _sessionId
    router.push(attemptedPath.value || { name: AppRoute.MAP })
  }

  function unsetAuthenticatedUser() {
    me.value = null
    sessionId.value = null
    router.push({ name: AppRoute.SIGNIN })
  }

  /**
   * Save promise object when fetching current user
   * Used in router auth guards to wait until user response loads
   */
  function setAuthenticatedUserPromise(promise) {
    authenticatedUserPromise.value = promise
  }

  return {
    me,
    sessionId,
    stashPath,
    setAuthenticatedUser,
    unsetAuthenticatedUser,
    authenticatedUserPromise,
    setAuthenticatedUserPromise,
  }
})
