import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { defineStore } from 'pinia'
import { PermissionId, User } from '@/types/auth.types'
import { Session } from '@/types/session.types'
import { isTauri } from '@/lib/api'
import { auth as deviceStore } from '@/lib/device-store'
import { api } from '@/lib/api'
import { useStorage } from '@vueuse/core'
import { jsonSerializer } from '@/lib/storage'

export const useAuthStore = defineStore('auth', () => {
  const router = useRouter()

  const cachedUser = useStorage<User | null>('parchment-user', null, undefined, {
    serializer: jsonSerializer,
  })

  const me = ref<User | null | undefined>(cachedUser.value ?? undefined)

  // Permissions and subscription are cached in localStorage alongside the user
  // so the map-engine decision (Mapbox is premium-gated) is correct
  // synchronously on page load. Without this, `permissions` starts empty on
  // every reload, the map falls back to MapLibre, and then swaps to Mapbox
  // once the async permissions fetch resolves — rendering both engines.
  const permissions = useStorage<PermissionId[]>(
    'parchment-permissions',
    [],
    undefined,
    { serializer: jsonSerializer },
  )
  const subscription = useStorage<{
    isPremium: boolean
    isBasic: boolean
    hasSubscription: boolean
    tier: string
  } | null>('parchment-subscription', null, undefined, {
    serializer: jsonSerializer,
  })
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

  const needsOnboarding = computed(
    () => me.value != null && me.value.onboardingCompletedAt == null,
  )

  async function setAuthenticatedUser(user: User, _sessionId: Session['id']) {
    me.value = user
    cachedUser.value = user // Persist to localStorage
    sessionId.value = _sessionId

    if (isTauri) {
      await deviceStore.setToken(_sessionId)
    }

    if (!user.onboardingCompletedAt) return

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

  function setSubscription(_subscription: { isPremium: boolean; isBasic: boolean; hasSubscription: boolean; tier: string }) {
    subscription.value = _subscription
  }

  async function unsetAuthenticatedUser() {
    me.value = null
    cachedUser.value = null // Clear localStorage cache
    permissions.value = [] // Clear cached premium permissions
    subscription.value = null // Clear cached subscription
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

  // --- Impersonation (dev only) ---
  const originalSession = ref<{
    token: string | null
    user: User
  } | null>(
    JSON.parse(sessionStorage.getItem('parchment-original-session') ?? 'null'),
  )

  const isImpersonating = computed(() => originalSession.value !== null)

  function startImpersonation(newToken: string, newUser: User) {
    originalSession.value = {
      token: sessionId.value,
      user: me.value!,
    }
    sessionStorage.setItem(
      'parchment-original-session',
      JSON.stringify(originalSession.value),
    )

    sessionId.value = newToken
    me.value = newUser
    cachedUser.value = newUser
    api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`
  }

  function stopImpersonation() {
    if (!originalSession.value) return

    const orig = originalSession.value
    sessionId.value = orig.token
    me.value = orig.user
    cachedUser.value = orig.user

    if (orig.token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${orig.token}`
    } else {
      delete api.defaults.headers.common['Authorization']
    }

    originalSession.value = null
    sessionStorage.removeItem('parchment-original-session')
  }

  return {
    me,
    needsOnboarding,
    permissions,
    subscription,
    sessionId,
    stashPath,
    setAuthToken,
    setAuthenticatedUser,
    updateUser,
    setPermissions,
    setSubscription,
    unsetAuthenticatedUser,
    authenticatedUserPromise,
    setAuthenticatedUserPromise,
    sessions,
    setSessions,
    removeSession,
    isImpersonating,
    startImpersonation,
    stopImpersonation,
  }
})
