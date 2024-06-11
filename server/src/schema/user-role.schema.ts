import { pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import { users } from './user.schema'
import { roles } from './role.schema'
import { relations } from 'drizzle-orm'

export const usersToRoles = pgTable(
  'user_role',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'no action' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.roleId] }),
  }),
)

export const usersToRolesRelations = relations(usersToRoles, ({ one }) => ({
  user: one(users, {
    fields: [usersToRoles.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [usersToRoles.roleId],
    references: [roles.id],
  }),
}))

export type UserRole = typeof usersToRoles.$inferSelect
export type NewUserRole = typeof usersToRoles.$inferInsert
