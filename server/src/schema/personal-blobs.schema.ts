import { pgTable, text, integer, timestamp, primaryKey } from 'drizzle-orm/pg-core'
import { users } from './users.schema'

/**
 * Generic E2EE blob storage keyed by (user_id, blob_type).
 *
 * The server is opaque to contents — it stores ciphertext + nonce + key
 * version and never decrypts. Clients encrypt under the user's personal
 * key (HKDF context `parchment-personal-v1` today) and sync per blob type.
 *
 * Types we plan to host on this table:
 *   - 'search-history'     (Part C.5b)
 *   - 'friend-pins'        (Part B.3 sync across devices)
 *   - 'direct-creds:<id>'  (Part C.5a direct-mode integration credentials)
 *
 * One row per (user, type); PUT is a full-blob replace. No server-side
 * query paths — clients read the blob, decrypt in-memory, search locally.
 */
export const encryptedUserBlobs = pgTable(
  'encrypted_user_blobs',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blobType: text('blob_type').notNull(),
    encryptedBlob: text('encrypted_blob').notNull(), // base64 v2 envelope
    nonce: text('nonce').notNull(), // kept for legacy envelopes; v2 blobs carry nonce internally
    kmVersion: integer('km_version').notNull().default(1),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.blobType] })],
)

export type EncryptedUserBlob = typeof encryptedUserBlobs.$inferSelect
export type NewEncryptedUserBlob = typeof encryptedUserBlobs.$inferInsert
