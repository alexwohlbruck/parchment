import { api } from '@/lib/api'
import { createSharedComposable } from '@vueuse/core'

export type PaginatedUsers = {
  data: any[]
  total: number
  page: number
  limit: number
}

function userService() {
  async function getUsers(page = 1, limit = 25): Promise<PaginatedUsers> {
    const { data } = await api.get('/users', { params: { page, limit } })
    return data
  }

  async function getRoles() {
    const { data: roles } = await api.get('/users/roles')
    return roles
  }

  async function getPermissions() {
    const { data: permissions } = await api.get('/users/permissions')
    return permissions
  }

  async function getPermission(id: string) {
    const { data } = await api.get(`/users/permissions/${id}`)
    return data
  }

  async function inviteUser(user: {
    email: string
    roles?: string[]
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
    picture?: string | null
  }) {
    const { data } = await api.patch('/users/me/profile', fields)
    return data
  }

  async function uploadAvatar(file: File): Promise<{ picture: string }> {
    const formData = new FormData()
    formData.append('file', file)
    const { data } = await api.post('/users/me/avatar', formData)
    return data
  }

  async function deleteAvatar(): Promise<void> {
    await api.delete('/users/me/avatar')
  }

  async function getUser(id: string) {
    const { data } = await api.get(`/users/${id}`)
    return data
  }

  async function updateUser(
    id: string,
    fields: {
      firstName?: string
      lastName?: string
      email?: string
      roles?: string[]
    },
  ) {
    const { data } = await api.patch(`/users/${id}`, fields)
    return data
  }

  async function deleteUser(id: string) {
    await api.delete(`/users/${id}`)
  }

  async function getRole(id: string) {
    const { data } = await api.get(`/users/roles/${id}`)
    return data
  }

  async function createRole(fields: {
    id?: string
    name: string
    description?: string
    permissions?: string[]
  }) {
    const { data } = await api.post('/users/roles', fields)
    return data
  }

  async function updateRole(
    id: string,
    fields: { name?: string; description?: string },
  ) {
    const { data } = await api.patch(`/users/roles/${id}`, fields)
    return data
  }

  async function deleteRole(id: string) {
    await api.delete(`/users/roles/${id}`)
  }

  async function setRolePermissions(roleId: string, permissions: string[]) {
    const { data } = await api.put(`/users/roles/${roleId}/permissions`, {
      permissions,
    })
    return data
  }

  async function getUserBilling(id: string) {
    const { data } = await api.get(`/users/${id}/billing`)
    return data
  }

  async function impersonateUser(id: string) {
    const { data } = await api.post(`/users/${id}/impersonate`)
    return data as { sessionId: string; user: any }
  }

  async function checkAliasAvailability(alias: string): Promise<boolean> {
    const { data } = await api.get<{ available: boolean }>('/users/alias/check', {
      params: { alias },
    })
    return data.available
  }

  return {
    getUsers,
    getUser,
    getUserBilling,
    getRoles,
    getRole,
    getPermissions,
    getPermission,
    inviteUser,
    updateUser,
    deleteUser,
    createRole,
    updateRole,
    deleteRole,
    setRolePermissions,
    impersonateUser,
    updateMyProfile,
    uploadAvatar,
    deleteAvatar,
    checkAliasAvailability,
  }
}

export const useUserService = createSharedComposable(userService)
