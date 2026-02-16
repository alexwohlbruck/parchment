import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { defineStore } from 'pinia'
import { PermissionId, User } from '@/types/auth.types'
import { Session } from '@/types/session.types'
import { isTauri } from '@/lib/api'
import { auth as deviceStore } from '@/lib/device-store'
import { api } from '@/lib/api'
import { useStorage } from '@vueuse/core'

export const useAuthStore = defineStore('auth', () => {
  const router = useRouter()

  const cachedUser = useStorage<User | null>('parchment-user', null)
  
  const me = ref<User | null | undefined>(cachedUser.value ?? undefined)
  const permissions = ref<PermissionId[]>([])
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

  function setAuthToken(token: Session['id']) {
    sessionId.value = token
  }

  async function setAuthenticatedUser(user: User, _sessionId: Session['id']) {
    me.value = user
    cachedUser.value = user // Persist to localStorage
    sessionId.value = _sessionId

    if (isTauri) {
      await deviceStore.setToken(_sessionId)
    }

    router.push(stashedPath.value || { name: AppRoute.MAP })
  }
  
  // Update user without navigation (for background refresh)
  function updateUser(user: User | null) {
    me.value = user
    cachedUser.value = user
  }

  function setPermissions(_permissions: PermissionId[]) {
    permissions.value = _permissions
  }

  async function unsetAuthenticatedUser() {
    me.value = null
    cachedUser.value = null // Clear localStorage cache
    sessionId.value = null
    authenticatedUserPromise.value = undefined // Clear the promise to prevent router guards from waiting
    if (isTauri) {
      await deviceStore.clearToken()
    }
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
    permissions,
    sessionId,
    stashPath,
    setAuthToken,
    setAuthenticatedUser,
    updateUser,
    setPermissions,
    unsetAuthenticatedUser,
    authenticatedUserPromise,
    setAuthenticatedUserPromise,
    sessions,
    setSessions,
    removeSession,
  }
})
