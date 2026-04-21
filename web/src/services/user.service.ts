import { api } from '@/lib/api'
import { createSharedComposable } from '@vueuse/core'
import {
  encryptMetadataField,
  tryDecryptMetadataField,
} from '@/lib/metadata-crypto'
import { getSeed } from '@/lib/key-storage'
import type { User } from '@/types/auth.types'

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

  async function inviteUser(user: { email: string; picture?: string }) {
    // Display name is metadata-encrypted and set by the invitee after login.
    // Admins cannot provide names at invite time — they don't hold the
    // invitee's seed.
    const { data: newUser } = await api.post('/users', user)
    return newUser
  }

  /**
   * Fetch the current user's metadata-encrypted display profile envelopes.
   * Decryption happens in the caller (identity store), which has the seed.
   */
  async function getMyProfile() {
    const { data } = await api.get('/users/me/profile')
    return data as {
      firstNameEncrypted: string | null
      lastNameEncrypted: string | null
      picture: string | null
    }
  }

  /**
   * Upload new metadata-encrypted envelopes for the current user's profile.
   */
  async function updateMyProfile(envelopes: {
    firstNameEncrypted?: string | null
    lastNameEncrypted?: string | null
  }) {
    const { data } = await api.patch('/users/me/profile', envelopes)
    return data
  }

  /**
   * Decrypt first/last name envelopes on a user record into cleartext fields
   * for in-memory display. Used when hydrating `me` from the server. Silent
   * on decrypt failure — missing seed returns the user unchanged.
   */
  async function decryptDisplayNames(raw: RawUserWithEnvelopes): Promise<User> {
    const seed = await getSeed()
    const user: User = {
      id: raw.id,
      email: raw.email,
      emailVerified: raw.emailVerified ?? false,
      picture: raw.picture ?? undefined,
      alias: raw.alias ?? undefined,
      roles: raw.roles,
      sessionCount: raw.sessionCount,
      firstName: null,
      lastName: null,
    }
    if (!seed) return user
    user.firstName = tryDecryptMetadataField({
      envelope: raw.firstNameEncrypted,
      seed,
      userId: raw.id,
      fieldName: 'first_name',
    })
    user.lastName = tryDecryptMetadataField({
      envelope: raw.lastNameEncrypted,
      seed,
      userId: raw.id,
      fieldName: 'last_name',
    })
    return user
  }

  /**
   * Encrypt + upload new first/last name values for the current user.
   * Both fields optional — pass an empty string to clear a field (encrypted
   * empty-envelope), or null to leave unchanged.
   */
  async function setMyDisplayName(params: {
    userId: string
    firstName?: string | null
    lastName?: string | null
  }) {
    const seed = await getSeed()
    if (!seed) throw new Error('Identity seed not available')
    const body: {
      firstNameEncrypted?: string | null
      lastNameEncrypted?: string | null
    } = {}
    if (params.firstName !== undefined) {
      body.firstNameEncrypted =
        params.firstName === null
          ? null
          : encryptMetadataField({
              plaintext: params.firstName,
              seed,
              userId: params.userId,
              fieldName: 'first_name',
            })
    }
    if (params.lastName !== undefined) {
      body.lastNameEncrypted =
        params.lastName === null
          ? null
          : encryptMetadataField({
              plaintext: params.lastName,
              seed,
              userId: params.userId,
              fieldName: 'last_name',
            })
    }
    return updateMyProfile(body)
  }

  return {
    getUsers,
    getRoles,
    getPermissions,
    inviteUser,
    getMyProfile,
    updateMyProfile,
    decryptDisplayNames,
    setMyDisplayName,
  }
}

/**
 * Shape the server returns for a user row including encrypted display-name
 * envelopes. Used only by decryptDisplayNames as an input type.
 */
interface RawUserWithEnvelopes {
  id: string
  email: string
  emailVerified?: boolean
  alias?: string | null
  picture?: string | null
  firstNameEncrypted?: string | null
  lastNameEncrypted?: string | null
  roles?: User['roles']
  sessionCount?: number
}

export const useUserService = createSharedComposable(userService)
