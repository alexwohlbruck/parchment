import { pgTable, text, timestamp, pgEnum, boolean } from 'drizzle-orm/pg-core'
import { users } from './user'
import { sql } from 'drizzle-orm'

export const tokenType = pgEnum('token_type', ['otp', 'token'])

export const tokens = pgTable('token', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: tokenType('type').notNull(),
  ephemeral: boolean('ephemeral').default(false),
  value: text('value'),
  hash: text('hash'),
  expires: timestamp('expires')
    .notNull()
    .default(sql`now() + interval '15 minute'`),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export type Token = typeof tokens.$inferSelect
export type NewToken = typeof tokens.$inferInsert
