import { api } from '@/lib/api'
import { createSharedComposable } from '@vueuse/core'

function userService() {
  async function getUsers() {
    const { data: users } = await api.get('/users')
    return users
  }

  async function getRoles() {
    const { data: roles } = await api.get('/users/roles')
    return roles
  }

  async function getPermissions() {
    const { data: permissions } = await api.get('/users/permissions')
    return permissions
  }

  return {
    getUsers,
    getRoles,
    getPermissions,
  }
}

export const useUserService = createSharedComposable(userService)
