import { Permission as PermissionId } from '../../../server/src/types/auth.types'

export { PermissionId }

export type Role = {
  id: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
}

export type Permission = {
  id: string
  name: string
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
  firstName?: string
  lastName?: string
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
