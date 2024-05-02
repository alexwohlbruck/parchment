import { pgTable, text, timestamp, boolean, bigint } from 'drizzle-orm/pg-core'
import { users } from './user'

export const passkeys = pgTable('passkey', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  webauthnUserId: text('webauthn_user_id').notNull(),
  counter: bigint('counter', { mode: 'number' }).notNull(),
  deviceType: text('device_type').notNull(),
  backedUp: boolean('backed_up').notNull().default(false),
  transports: text('transports').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
})

export type Passkey = typeof passkeys.$inferSelect
export type NewPasskey = typeof passkeys.$inferInsert
