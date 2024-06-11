import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { usersToRoles } from './user-role.schema'
import { relations } from 'drizzle-orm'

export const roles = pgTable('role', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
})

export const rolesRelations = relations(roles, ({ many }) => ({
  usersToRoles: many(usersToRoles),
}))

export type Role = typeof roles.$inferSelect
export type NewRole = typeof roles.$inferInsert
