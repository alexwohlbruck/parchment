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
    id: PermissionId.INTEGRATIONS_READ_USER,
    name: 'Read User Integrations',
    description: 'View user-scoped integration configurations',
  },
  {
    id: PermissionId.INTEGRATIONS_WRITE_USER,
    name: 'Write User Integrations',
    description:
      'Create, update, and delete user-scoped integration configurations',
  },
  {
    id: PermissionId.INTEGRATIONS_READ_SYSTEM,
    name: 'Read System Integrations',
    description: 'View system-wide integration configurations in settings',
  },
  {
    id: PermissionId.INTEGRATIONS_WRITE_SYSTEM,
    name: 'Write System Integrations',
    description:
      'Create, update, and delete system-wide integration configurations',
  },
  {
    id: PermissionId.LAYERS_READ,
    name: 'View map layers',
    description: 'View and use map layers',
  },
  {
    id: PermissionId.LAYERS_WRITE,
    name: 'Manage map layers',
    description: 'Create, update, and reorder map layers and layer groups',
  },
  {
    id: PermissionId.LAYERS_DELETE,
    name: 'Delete map layers',
    description: 'Delete map layers and layer groups',
  },
  {
    id: PermissionId.SEARCH_AUTO_REFRESH,
    name: 'Auto-refresh search results',
    description: 'Search results automatically refresh as the map is panned',
  },
  {
    id: PermissionId.PREMIUM_DATA_PROVIDERS,
    name: 'Premium data providers',
    description: 'Access to enhanced third-party business and place data',
  },
  {
    id: PermissionId.PREMIUM_LAYERS,
    name: 'Premium map layers',
    description: 'Advanced map layers including 3D terrain, weather, and more',
  },
  {
    id: PermissionId.PREMIUM_CUSTOM_MAPS,
    name: 'Unlimited custom maps',
    description: 'Create unlimited custom maps, sources, and layer configurations',
  },
  {
    id: PermissionId.PREMIUM_NAVIGATION,
    name: 'Premium navigation',
    description: 'Advanced routing preferences, voice guidance, and navigation features',
  },
  {
    id: PermissionId.PREMIUM_LOCATION_SHARING,
    name: 'Premium location sharing',
    description: 'Advanced real-time location sharing features',
  },
]
