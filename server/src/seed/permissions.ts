// TODO: Derive from db schema
export type Permission = {
  id: string
  name: string
}

/**
 * User permission definitions
 * Add new permissions as needed here, then run `bun seed` to populate the DB
 * Update any roles in ./roles.ts that require the new permissions
 * If you update any permission IDs, change them in ./roles.ts as well
 */
export const permissions: Permission[] = [
  {
    id: 'users:read',
    name: 'View all users',
  },
  {
    id: 'users:create',
    name: 'Invite new user',
  },
  {
    id: 'roles:read',
    name: 'Read user roles',
  },
  {
    id: 'permissions:read',
    name: 'Read user permissions',
  },
] as const
