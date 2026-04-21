import { pgTable, text, timestamp, integer } from 'drizzle-orm/pg-core'
import { users } from './users.schema'
import {
  IntegrationId,
  IntegrationCapabilityId,
} from '../types/integration.enums'

export const integrations = pgTable('integrations', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  integrationId: text('integration_id').$type<IntegrationId>().notNull(),
  // Integration config (API keys, bearer tokens, etc.) is encrypted at rest
  // under the server's master encryption key (PARCHMENT_INTEGRATION_ENCRYPTION_KEY
  // env var). Cleartext only exists in process memory at call time.
  // See server/src/lib/integration-encryption.ts for the wrapper.
  configCiphertext: text('config_ciphertext').notNull(), // base64 (ciphertext || gcm tag)
  configNonce: text('config_nonce').notNull(), // base64 (12B AES-GCM nonce)
  configKeyVersion: integer('config_key_version').notNull().default(1),
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

/**
 * Raw DB row shape — encrypted config columns. Internal to the integration
 * service's read path; other modules should NEVER operate on this type
 * directly. Use `IntegrationRecord` for the decrypted in-memory shape.
 */
export type IntegrationRow = typeof integrations.$inferSelect

import type {
  IntegrationId as _IntegrationId,
  IntegrationCapabilityId as _IntegrationCapabilityId,
} from '../types/integration.enums'

/**
 * In-memory decrypted integration — what service functions return and what
 * integration adapters consume. `config` is cleartext and MUST NOT be
 * persisted or logged.
 */
export interface IntegrationRecord {
  id: string
  userId: string | null
  integrationId: _IntegrationId
  capabilities: { id: _IntegrationCapabilityId; active: boolean }[]
  config: Record<string, any>
  createdAt: Date
  updatedAt: Date
}
