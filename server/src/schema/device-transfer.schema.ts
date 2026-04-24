import { pgTable, text, timestamp, boolean } from 'drizzle-orm/pg-core'
import { users } from './users.schema'

/**
 * Device-to-device recovery transfer sessions (Part C.8).
 *
 * A session is created by the NEW device (the receiver) containing its
 * ephemeral X25519 public key and optionally the authenticated user's id.
 * The EXISTING device (sender) uploads an encrypted seed payload keyed to
 * that ephemeral pub. Receiver downloads and decrypts client-side.
 *
 * Invariants enforced server-side:
 *   - TTL: sessions expire after 60s (`expiresAt`).
 *   - One-shot: once the payload is fetched by the receiver, `consumed` is
 *     set and no further reads are allowed.
 *   - The server NEVER sees the seed in cleartext — payload is E2EE-sealed
 *     to the receiver's ephemeral public key.
 */
export const deviceTransferSessions = pgTable('device_transfer_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  receiverEphemeralPub: text('receiver_ephemeral_pub').notNull(), // base64 X25519
  // Filled in once the sender uploads the encrypted payload:
  senderEphemeralPub: text('sender_ephemeral_pub'), // base64 X25519
  sealedSeed: text('sealed_seed'), // base64 v2 envelope of seed
  senderSignature: text('sender_signature'), // base64 Ed25519 signature by sender's long-term identity key
  consumed: boolean('consumed').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
})

export type DeviceTransferSession = typeof deviceTransferSessions.$inferSelect
export type NewDeviceTransferSession =
  typeof deviceTransferSessions.$inferInsert
