import { pgTable, text, timestamp, boolean, bigint } from 'drizzle-orm/pg-core'
import { users } from './user.schema'

export const passkeys = pgTable('passkey', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  publicKey: text('public_key').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  counter: bigint('counter', { mode: 'number' }).notNull(),
  deviceType: text('device_type').notNull(),
  backedUp: boolean('backed_up').notNull().default(false),
  transports: text('transports').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export type Passkey = typeof passkeys.$inferSelect
export type NewPasskey = typeof passkeys.$inferInsert
