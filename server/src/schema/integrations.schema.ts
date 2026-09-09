import { pgTable, text, timestamp, integer, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from './users.schema'
import {
  IntegrationId,
  IntegrationCapabilityId,
} from '../types/integration.enums'

export type IntegrationScheme = 'server-key' | 'user-e2ee'

export const integrations = pgTable(
  'integrations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id),
    integrationId: text('integration_id').$type<IntegrationId>().notNull(),
    // Which encryption scheme stores this integration's config:
    //   - 'server-key': config_ciphertext/config_nonce are populated; server
    //     encrypts + decrypts under PARCHMENT_INTEGRATION_ENCRYPTION_KEY.
    //   - 'user-e2ee': ciphertext/nonce are NULL; the actual config lives in
    //     encrypted_user_blobs under blob_type 'integration-config:<id>',
    //     encrypted under the user's personal key. Server never sees cleartext.
    scheme: text('scheme')
      .$type<IntegrationScheme>()
      .notNull()
      .default('server-key'),
    // Integration config (API keys, bearer tokens, etc.) is encrypted at rest
    // under the server's master encryption key (PARCHMENT_INTEGRATION_ENCRYPTION_KEY
    // env var). Cleartext only exists in process memory at call time.
    // See server/src/lib/integration-encryption.ts for the wrapper.
    // NULL for scheme='user-e2ee' rows — those configs live in encrypted_user_blobs.
    configCiphertext: text('config_ciphertext'), // base64 (ciphertext || gcm tag)
    configNonce: text('config_nonce'), // base64 (12B AES-GCM nonce)
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
  },
  (t) => [
    // One config per (user, integration, scheme) — prevents duplicate
    // Dawarich/etc rows per user within the same scheme. System rows
    // (user_id IS NULL) are excluded; their uniqueness (if any) is unchanged.
    uniqueIndex('integrations_user_scheme_uq')
      .on(t.userId, t.integrationId, t.scheme)
      .where(sql`user_id IS NOT NULL`),
  ],
)

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
 *
 * For `scheme='user-e2ee'` rows the server can't decrypt the config, so
 * `config` is `{}` and `encryptedConfig` (the v2 envelope string) is attached
 * for the client to decrypt locally. `encryptedConfig` is only populated on
 * the `getConfiguredIntegrations(userId)` response path — never on internal
 * adapter-facing code paths.
 */
export interface IntegrationRecord {
  id: string
  userId: string | null
  integrationId: _IntegrationId
  scheme: IntegrationScheme
  capabilities: { id: _IntegrationCapabilityId; active: boolean }[]
  config: Record<string, any>
  encryptedConfig?: string
  createdAt: Date
  updatedAt: Date
}
