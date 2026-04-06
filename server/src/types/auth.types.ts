export type { Permission, NewPermission } from '../schema/permissions.schema'

export enum PermissionId {
  USERS_READ = 'users:read',
  USERS_CREATE = 'users:create',
  ROLES_READ = 'roles:read',
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
}

export type PermissionRule =
  | PermissionId
  | {
      all?: PermissionId | PermissionId[]
      any?: PermissionId[]
    }
