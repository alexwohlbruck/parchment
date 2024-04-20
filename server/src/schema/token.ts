import { pgTable, text, timestamp, pgEnum, boolean } from 'drizzle-orm/pg-core'
import { users } from './user'
import { sql } from 'drizzle-orm'

const tokenType = pgEnum('string', ['otp', 'passkey'])

export const tokens = pgTable('token', {
  id: text('id').primaryKey(),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: tokenType('type').notNull(),
  ephemeral: boolean('ephemeral').default(false),
  hash: text('token').notNull(),
  expires: timestamp('expires')
    .notNull()
    .default(sql`now() + interval '15 minute'`),
  created_at: timestamp('created_at').notNull().defaultNow(),
})

export type Token = typeof tokens.$inferSelect
export type NewToken = typeof tokens.$inferInsert
