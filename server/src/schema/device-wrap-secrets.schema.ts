import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { users } from './users.schema'

/**
 * Per-device wrap secrets for the browser/mobile `localStorage` seed.
 *
 * Browser and mobile-Tauri webview builds can't reach an OS keychain, so
 * the master seed persists in `localStorage` for instant cold-open. To
 * stop a passive filesystem read from yielding the plaintext seed, the
 * client wraps the seed under a key derived from a secret held here on
 * the server. "Sign out of all devices" rotates these rows — every cached
 * envelope on every device then fails AEAD on next open and the user
 * must re-unlock via passkey / recovery key.
 *
 * The secret transits TLS + memory only; it is never written to client
 * disk in the clear (the client derives a wrap key from it via HKDF and
 * discards the raw secret after deriving).
 */
export const deviceWrapSecrets = pgTable(
  'device_wrap_secrets',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    secret: text('secret').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    rotatedAt: timestamp('rotated_at').notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.deviceId] }),
    userIdIdx: index('device_wrap_secrets_user_id_idx').on(t.userId),
  }),
)

export type DeviceWrapSecret = typeof deviceWrapSecrets.$inferSelect
export type NewDeviceWrapSecret = typeof deviceWrapSecrets.$inferInsert
