export * from '@server/types/auth.types'
import type { PermissionId } from '@server/types/auth.types'

export type Role = {
  id: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
}

export type AnyPermission = PermissionId[]
export type PermissionRule =
  | PermissionId
  | {
      all?: PermissionId | PermissionId[]
      any?: PermissionId[]
    }

export type User = {
  id: string
  email: string
  emailVerified: boolean
  // Display name is metadata-encrypted at rest (Part C.4). The client
  // decrypts these envelopes for display; admin/federation paths see null.
  firstName?: string | null
  lastName?: string | null
  alias?: string | null
  picture?: string
  roles?: Role[]
  sessionCount?: number
}

export type Passkey = {
  id: string
  name: string
  publicKey: string
  userId: string
  counter: number
  deviceType: string
  backedUp: boolean
  transports: string
  createdAt: string
}
