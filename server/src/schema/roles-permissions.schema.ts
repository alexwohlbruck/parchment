import { pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { roles } from './roles.schema'
import { permissions } from './permissions.schema'

export const roleToPermissions = pgTable(
  'roles_permissions',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: text('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleId, t.permissionId] }),
  }),
)

export type RolePermission = typeof roleToPermissions.$inferSelect
export type NewRolePermission = typeof roleToPermissions.$inferInsert
