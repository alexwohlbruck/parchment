export type { Permission, NewPermission } from '../schema/permissions.schema'

export enum PermissionId {
  USERS_READ = 'users:read',
  USERS_CREATE = 'users:create',
  ROLES_READ = 'roles:read',
  PERMISSIONS_READ = 'permissions:read',
  SYSTEM_READ = 'system:read', // TODO
  INTEGRATIONS_READ = 'integrations:read',
  INTEGRATIONS_WRITE_USER = 'integrations:write:user',
  INTEGRATIONS_WRITE_SYSTEM = 'integrations:write:system',
  LAYERS_READ = 'layers:read',
  LAYERS_WRITE = 'layers:write',
  LAYERS_DELETE = 'layers:delete',
}

export type PermissionRule =
  | PermissionId
  | {
      all?: PermissionId | PermissionId[]
      any?: PermissionId[]
    }
