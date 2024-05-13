import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './user'

export const sessions = pgTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at', {
    withTimezone: true,
    mode: 'date',
  }).notNull(),
  ipv4: text('ipv4'),
  userAgent: text('user_agent'),
})

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
