import { pgTable, serial, text } from 'drizzle-orm/pg-core'

export const users = pgTable('user', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  first_name: text('first_name'),
  last_name: text('last_name'),
  picture: text('picture'),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
