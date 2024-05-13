import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { defineStore } from 'pinia'
import { User } from '@/types/auth.types'
import { Session } from '@/types/session.types'

export const useAuthStore = defineStore('user', () => {
  const router = useRouter()

  const me = ref<User | null>(null)
  const sessionId = ref<Session['id'] | null>(null)

  function setAuthenticatedUser(user: User, _sessionId: Session['id']) {
    me.value = user
    sessionId.value = _sessionId
    router.push('/')
  }

  function unsetAuthenticatedUser() {
    me.value = null
    sessionId.value = null
    router.push('/signin')
  }

  return {
    me,
    sessionId,
    setAuthenticatedUser,
    unsetAuthenticatedUser,
  }
})
