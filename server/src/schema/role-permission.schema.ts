import { pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { roles } from './role.schema'
import { permissions } from './permission.schema'

export const roleToPermissions = pgTable(
  'role_permission',
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
