export type { Permission, NewPermission } from '../schema/permissions.schema'

export enum PermissionId {
  USERS_READ = 'users:read',
  USERS_CREATE = 'users:create',
  USERS_UPDATE = 'users:update',
  USERS_DELETE = 'users:delete',
  ROLES_READ = 'roles:read',
  ROLES_CREATE = 'roles:create',
  ROLES_WRITE = 'roles:write',
  ROLES_DELETE = 'roles:delete',
  PERMISSIONS_READ = 'permissions:read',
  SYSTEM_READ = 'system:read', // TODO
  INTEGRATIONS_READ_USER = 'integrations:read:user',
  INTEGRATIONS_WRITE_USER = 'integrations:write:user',
  INTEGRATIONS_READ_SYSTEM = 'integrations:read:system',
  INTEGRATIONS_WRITE_SYSTEM = 'integrations:write:system',
  LAYERS_READ = 'layers:read',
  LAYERS_WRITE = 'layers:write',
  LAYERS_DELETE = 'layers:delete',
  SEARCH_AUTO_REFRESH = 'search:auto_refresh',
  PREMIUM_DATA_PROVIDERS = 'premium:data_providers',
  PREMIUM_LAYERS = 'premium:layers',
  PREMIUM_CUSTOM_MAPS = 'premium:custom_maps',
  PREMIUM_NAVIGATION = 'premium:navigation',
  PREMIUM_LOCATION_SHARING = 'premium:location_sharing',
  LIBRARY_READ = 'library:read',
  LIBRARY_WRITE = 'library:write',
  SOCIAL_READ = 'social:read',
  SOCIAL_WRITE = 'social:write',
  SHARING_READ = 'sharing:read',
  SHARING_WRITE = 'sharing:write',
  LOCATION_SHARING = 'location:sharing',
  NOTES_WRITE = 'notes:write',
}

export type PermissionRule =
  | PermissionId
  | {
      all?: PermissionId | PermissionId[]
      any?: PermissionId[]
    }
