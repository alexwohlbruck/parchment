import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './user.schema'

export const integrations = pgTable('integrations', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .references(() => users.id)
    .notNull(),
  integrationId: text('integration_id').notNull(),
  config: text('config').notNull(), // JSON string
  capabilities: text('capabilities').notNull(), // JSON string
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type Integration = typeof integrations.$inferSelect
