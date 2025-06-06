import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users.schema'
import {
  IntegrationId,
  IntegrationCapabilityId,
} from '../types/integration.enums'

export const integrations = pgTable('integrations', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  integrationId: text('integration_id').$type<IntegrationId>().notNull(),
  config: text('config').$type<Record<string, any>>().notNull(), // JSON string
  capabilities: text('capabilities')
    .$type<
      {
        id: IntegrationCapabilityId
        active: boolean
      }[]
    >()
    .notNull(), // JSON string
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type IntegrationRecord = typeof integrations.$inferSelect
