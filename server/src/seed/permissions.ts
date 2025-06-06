import { PermissionId } from '../types/auth.types'

/**
 * User permission definitions
 * Add new permissions as needed here, then run `bun seed` to populate the DB
 * Update any roles in ./roles.ts that require the new permissions
 * If you update any permission IDs, change them in ./roles.ts as well
 */
export const permissions: {
  id: PermissionId
  name: string
  description?: string
}[] = [
  {
    id: PermissionId.USERS_READ,
    name: 'View all users',
  },
  {
    id: PermissionId.USERS_CREATE,
    name: 'Invite new user',
  },
  {
    id: PermissionId.ROLES_READ,
    name: 'Read user roles',
  },
  {
    id: PermissionId.PERMISSIONS_READ,
    name: 'Read user permissions',
  },
  {
    id: PermissionId.SYSTEM_READ,
    name: 'Read system status data',
  },
  {
    id: PermissionId.INTEGRATIONS_READ,
    name: 'View integrations',
  },
  {
    id: PermissionId.INTEGRATIONS_WRITE_USER,
    name: 'Write User Integrations',
    description:
      'Create, update, and delete user-scoped integration configurations',
  },
  {
    id: PermissionId.INTEGRATIONS_WRITE_SYSTEM,
    name: 'Write System Integrations',
    description:
      'Create, update, and delete system-wide integration configurations',
  },
]
