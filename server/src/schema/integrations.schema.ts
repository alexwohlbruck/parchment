import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users.schema'

export const integrations = pgTable('integrations', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  integrationId: text('integration_id').notNull(),
  config: text('config').notNull(), // JSON string
  capabilities: text('capabilities').notNull(), // JSON string
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type IntegrationRecord = typeof integrations.$inferSelect
