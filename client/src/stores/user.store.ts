import { ref } from 'vue'
import { defineStore } from 'pinia'
import { User } from '@/types/auth.types'

export const useUserStore = defineStore('user', () => {
  const me = ref<User | null>(null)

  function setAuthenticatedUser(user: User) {
    me.value = user
  }

  function unsetAuthenticatedUser() {
    me.value = null
  }

  return {
    me,
    setAuthenticatedUser,
    unsetAuthenticatedUser,
  }
})
