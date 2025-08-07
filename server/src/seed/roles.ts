import { PermissionId } from '../types/auth.types'

// TODO: Derive from db schema
export type Role = {
  id: string
  name: string
  description: string
  permissions: PermissionId[] | '*'
}

/**
 * User role definitions
 * Add new roles as needed here, then run `bun seed` to populate the DB
 * Note: Do not update role IDs if possible. If you do, all users will lose that role and will have to be reassigned
 */

const user: Role = {
  id: 'user',
  name: 'User',
  description: 'A user that can view and browse the map',
  permissions: [
    PermissionId.INTEGRATIONS_READ,
    PermissionId.LAYERS_READ,
    PermissionId.LAYERS_WRITE,
  ],
}

const alpha: Role = {
  id: 'alpha',
  name: 'Alpha tester',
  description:
    'A privileged user that is able to read all data in the app, but has limited write permissions',
  permissions: [
    PermissionId.INTEGRATIONS_READ,
    PermissionId.INTEGRATIONS_WRITE_USER,
    PermissionId.SYSTEM_READ,
    PermissionId.LAYERS_READ,
    PermissionId.LAYERS_WRITE,
    PermissionId.LAYERS_DELETE,
    // Permission.USERS_READ,
    // Permission.ROLES_READ,
    // Permission.PERMISSIONS_READ,
  ],
}

const admin: Role = {
  id: 'admin',
  name: 'Administrator',
  description:
    'An privileged user that is able to read and write all app data and configuration',
  permissions: '*',
}

export const roles: Role[] = [user, alpha, admin]
