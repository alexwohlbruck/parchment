import { api } from '@/lib/api'
import { createSharedComposable } from '@vueuse/core'

function userService() {
  async function getUsers() {
    const { data: users } = await api.get('/users')
    return users
  }

  return {
    getUsers,
  }
}

export const useUserService = createSharedComposable(userService)
