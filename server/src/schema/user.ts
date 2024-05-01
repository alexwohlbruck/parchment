import { boolean, pgTable, serial, text } from 'drizzle-orm/pg-core'

export const users = pgTable('user', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  firstName: text('first_name'),
  lastName: text('last_name'),
  picture: text('picture'),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
