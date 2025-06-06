import { Permission } from '../types/auth.types'

/**
 * User permission definitions
 * Add new permissions as needed here, then run `bun seed` to populate the DB
 * Update any roles in ./roles.ts that require the new permissions
 * If you update any permission IDs, change them in ./roles.ts as well
 */
export const permissions: {
  id: Permission
  name: string
  description?: string
}[] = [
  {
    id: Permission.USERS_READ,
    name: 'View all users',
  },
  {
    id: Permission.USERS_CREATE,
    name: 'Invite new user',
  },
  {
    id: Permission.ROLES_READ,
    name: 'Read user roles',
  },
  {
    id: Permission.PERMISSIONS_READ,
    name: 'Read user permissions',
  },
  {
    id: Permission.SYSTEM_READ,
    name: 'Read system status data',
  },
  {
    id: Permission.INTEGRATIONS_READ,
    name: 'View integrations',
  },
  {
    id: Permission.INTEGRATIONS_WRITE_USER,
    name: 'Write User Integrations',
    description:
      'Create, update, and delete user-scoped integration configurations',
  },
  {
    id: Permission.INTEGRATIONS_WRITE_SYSTEM,
    name: 'Write System Integrations',
    description:
      'Create, update, and delete system-wide integration configurations',
  },
]
