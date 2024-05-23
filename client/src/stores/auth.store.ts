import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { defineStore } from 'pinia'
import { User } from '@/types/auth.types'
import { Session } from '@/types/session.types'

export const useAuthStore = defineStore('user', () => {
  const router = useRouter()

  const me = ref<User | null | undefined>()
  const sessions = ref<Session[]>([])
  const sessionId = ref<Session['id'] | null>(null)
  const stashedPath = ref<string | null>(null)
  const authenticatedUserPromise = ref<Promise<any>>()

  /**
   * Save path the user has visited on page load.
   * If signed out, we restore this path upon sign in
   */
  function stashPath(path: string) {
    stashedPath.value = path
  }

  function setAuthenticatedUser(user: User, _sessionId: Session['id']) {
    me.value = user
    sessionId.value = _sessionId
    router.push(stashedPath.value || { name: AppRoute.MAP })
  }

  function unsetAuthenticatedUser() {
    me.value = null
    sessionId.value = null
    router.push({ name: AppRoute.SIGNIN })
  }

  function setSessions(_sessions: Session[]) {
    sessions.value = _sessions
  }

  function removeSession(sessionId: Session['id']) {
    const index = sessions.value.findIndex(session => session.id === sessionId)
    if (index !== -1) {
      sessions.value.splice(index, 1)
    }
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
    sessions,
    setSessions,
    removeSession,
  }
})
