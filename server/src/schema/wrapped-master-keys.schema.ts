import {
  pgTable,
  text,
  timestamp,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { users } from './users.schema'
import { passkeys } from './passkeys.schema'

/**
 * Passkey-PRF wrapped master-key slots (Part C.6).
 *
 * Each row wraps the user's master key K_m (the seed) under a key derived
 * from the named passkey's PRF extension output. A user may have multiple
 * passkeys → multiple slots, each wrapping the same K_m. Unwrap on sign-in
 * is: PRF ceremony → PRF output → HKDF → unwrap key → AES-GCM decrypt →
 * K_m.
 *
 * `slotSignature` is an Ed25519 signature by the user's long-term identity
 * key over `(userId || credentialId || wrappedKm || wrapAlgo)`. The client
 * verifies this on read. A malicious home server that tries to inject a
 * different slot (e.g. to fool a new device into unwrapping a key of the
 * attacker's choosing) will fail signature verification.
 *
 * Schema is intentionally narrow — the server treats everything except
 * ownership as opaque bytes.
 */
export const wrappedMasterKeys = pgTable(
  'wrapped_master_keys',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id')
      .notNull()
      .references(() => passkeys.id, { onDelete: 'cascade' }),
    wrappedKm: text('wrapped_km').notNull(), // base64 v2 envelope of K_m under the PRF-derived key
    wrapAlgo: text('wrap_algo').notNull().default('aes-256-gcm-prf-v1'),
    slotSignature: text('slot_signature').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.credentialId] })],
)

export type WrappedMasterKey = typeof wrappedMasterKeys.$inferSelect
export type NewWrappedMasterKey = typeof wrappedMasterKeys.$inferInsert
