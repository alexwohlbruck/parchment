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
  description: 'A free user that can browse the map',
  permissions: [
    PermissionId.LAYERS_READ,
    PermissionId.LAYERS_WRITE,
  ],
}

const basic: Role = {
  id: 'basic',
  name: 'Basic',
  description: 'A Basic subscriber with access to all user content features',
  permissions: [
    PermissionId.LIBRARY_READ,
    PermissionId.LIBRARY_WRITE,
    PermissionId.SOCIAL_READ,
    PermissionId.SOCIAL_WRITE,
    PermissionId.SHARING_READ,
    PermissionId.SHARING_WRITE,
    PermissionId.LOCATION_SHARING,
    PermissionId.NOTES_WRITE,
    PermissionId.INTEGRATIONS_READ_USER,
    PermissionId.INTEGRATIONS_WRITE_USER,
    PermissionId.LAYERS_READ,
    PermissionId.LAYERS_WRITE,
  ],
}

const premium: Role = {
  id: 'premium',
  name: 'Premium',
  description: 'A paying subscriber with access to all premium features',
  permissions: [
    ...(basic.permissions as PermissionId[]),
    PermissionId.LAYERS_DELETE,
    PermissionId.SEARCH_AUTO_REFRESH,
    PermissionId.PREMIUM_DATA_PROVIDERS,
    PermissionId.PREMIUM_LAYERS,
    PermissionId.PREMIUM_CUSTOM_MAPS,
    PermissionId.PREMIUM_NAVIGATION,
    PermissionId.PREMIUM_LOCATION_SHARING,
  ],
}

const alpha: Role = {
  id: 'alpha',
  name: 'Alpha tester',
  description:
    'A privileged tester with every premium feature plus read-only, non-destructive access to admin data (users, roles, permissions, system integrations, and system status). Cannot make admin changes or view integration secrets.',
  permissions: [
    // Every premium feature (inherits the basic + premium permission sets)
    ...(premium.permissions as PermissionId[]),
    // Read-only, non-destructive admin access. Deliberately excludes every
    // write/create/delete admin permission and INTEGRATIONS_WRITE_SYSTEM —
    // system-integration secrets are only returned on the write path, so
    // read-system alone never exposes them.
    PermissionId.USERS_READ,
    PermissionId.ROLES_READ,
    PermissionId.PERMISSIONS_READ,
    PermissionId.INTEGRATIONS_READ_SYSTEM,
    PermissionId.SYSTEM_READ,
  ],
}

const admin: Role = {
  id: 'admin',
  name: 'Administrator',
  description:
    'An privileged user that is able to read and write all app data and configuration',
  permissions: '*',
}

export const roles: Role[] = [user, basic, premium, alpha, admin]
