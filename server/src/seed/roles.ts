import { Permission } from '../types/auth.types'
import { PermissionId, permissions } from './permissions'

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
export const roles: Role[] = [
  {
    id: 'user',
    name: 'User',
    description: 'A user that can view and browse the map',
    permissions: [],
  },
  {
    id: 'alpha',
    name: 'Alpha tester',
    description:
      'A privileged user that is able to read all data in the app, but has limited write permissions',
    permissions: [
      Permission.USERS_READ,
      Permission.ROLES_READ,
      Permission.PERMISSIONS_READ,
      Permission.SYSTEM_READ,
    ],
  },
  {
    id: 'admin',
    name: 'Administrator',
    description:
      'An privileged user that is able to read and write all app data and configuration',
    permissions: '*',
  },
]
