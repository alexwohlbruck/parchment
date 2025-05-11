export enum Permission {
  USERS_READ = 'users:read',
  USERS_CREATE = 'users:create',
  ROLES_READ = 'roles:read',
  PERMISSIONS_READ = 'permissions:read',
  SYSTEM_READ = 'system:read', // TODO
  INTEGRATIONS_READ = 'integrations:read',
}

export type PermissionRule =
  | Permission
  | {
      all?: Permission | Permission[]
      any?: Permission[]
    }
