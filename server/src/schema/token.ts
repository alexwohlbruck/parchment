import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './user'
import { sql } from 'drizzle-orm'

export const tokens = pgTable('token', {
  id: text('id').primaryKey(),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  expires: timestamp('expires')
    .notNull()
    .default(sql`now() + interval '15 minute'`),
  created_at: timestamp('created_at').notNull().defaultNow(),
})

export type Token = typeof tokens.$inferSelect
export type NewToken = typeof tokens.$inferInsert
