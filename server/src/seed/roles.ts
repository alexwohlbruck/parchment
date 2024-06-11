import { permissions } from './permissions'

// TODO: Get enum or boolean string type from permissions list
type PermissionId = (typeof permissions)[number]['id']

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
    permissions: ['users:read'],
  },
  {
    id: 'alpha',
    name: 'Alpha tester',
    description:
      'A privileged user that is able to read all data in the app, but has limited write permissions',
    permissions: ['users:read', 'roles:read', 'permissions:read'], // TODO: Add advanced wildcards, role inheritance
  },
  {
    id: 'admin',
    name: 'Administrator',
    description:
      'An administrator is able to read and write all app data and configuration',
    permissions: '*',
  },
]
