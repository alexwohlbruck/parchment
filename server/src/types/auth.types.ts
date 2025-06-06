export enum Permission {
  USERS_READ = 'users:read',
  USERS_CREATE = 'users:create',
  ROLES_READ = 'roles:read',
  PERMISSIONS_READ = 'permissions:read',
  SYSTEM_READ = 'system:read', // TODO
  INTEGRATIONS_READ = 'integrations:read',
  INTEGRATIONS_WRITE_USER = 'integrations:write:user',
  INTEGRATIONS_WRITE_SYSTEM = 'integrations:write:system',
}

export type PermissionRule =
  | Permission
  | {
      all?: Permission | Permission[]
      any?: Permission[]
    }
