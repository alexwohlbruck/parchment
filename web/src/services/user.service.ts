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

  async function inviteUser(user: {
    firstName: string
    lastName: string
    email: string
    picture?: string
  }) {
    const { data: newUser } = await api.post('/users', user)
    return newUser
  }

  /**
   * Update the current user's display profile (first/last name — cleartext).
   */
  async function updateMyProfile(fields: {
    firstName?: string | null
    lastName?: string | null
  }) {
    const { data } = await api.patch('/users/me/profile', fields)
    return data
  }

  return {
    getUsers,
    getRoles,
    getPermissions,
    inviteUser,
    updateMyProfile,
  }
}

export const useUserService = createSharedComposable(userService)
