import { relations } from 'drizzle-orm'
import { pgTable, text } from 'drizzle-orm/pg-core'
import { usersToRoles } from './user-role.schema'

export const users = pgTable('user', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  picture: text('picture'),
})

export const usersRelations = relations(users, ({ many }) => ({
  usersToRoles: many(usersToRoles),
}))

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
