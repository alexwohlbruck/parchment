import { pgTable, text, timestamp, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * Server-side pins of peer servers' Ed25519 identity keys.
 * TOFU model: first successful exchange with a peer pins its key; any change
 * must be flagged and approved out-of-band before accepting new keys.
 */
export const federatedServerKeys = pgTable(
  'federated_server_keys',
  {
    serverId: text('server_id').primaryKey(), // e.g. "parchment.example.com"
    publicKey: text('public_key').notNull(), // base64 Ed25519 public key
    minimumProtocolVersion: integer('minimum_protocol_version')
      .notNull()
      .default(2),
    firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  },
)

export type FederatedServerKey = typeof federatedServerKeys.$inferSelect
export type NewFederatedServerKey = typeof federatedServerKeys.$inferInsert

/**
 * Seen-nonce cache for replay protection. Each row is one nonce observed from
 * a given sender server; periodic sweep deletes rows older than the timestamp
 * skew window. Acts as a bounded sliding window per sender.
 */
export const federationNonces = pgTable(
  'federation_nonces',
  {
    senderServerId: text('sender_server_id').notNull(),
    nonce: text('nonce').notNull(),
    timestamp: timestamp('timestamp').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('federation_nonces_sender_nonce_uq').on(
      table.senderServerId,
      table.nonce,
    ),
    index('federation_nonces_created_at_idx').on(table.createdAt),
  ],
)

export type FederationNonce = typeof federationNonces.$inferSelect
export type NewFederationNonce = typeof federationNonces.$inferInsert

/**
 * Server-side storage for client-encrypted friend key pins. Pins are encrypted
 * under the user's seed; the server holds only opaque ciphertext for cross-
 * device sync. The (userId, friendHandle) pair is visible to the server since
 * that routing already is — actual pinned key material is not.
 */
export const userFriendPins = pgTable(
  'user_friend_pins',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    friendHandle: text('friend_handle').notNull(),
    encryptedPin: text('encrypted_pin').notNull(), // base64 ciphertext
    nonce: text('nonce').notNull(), // base64 nonce
    pinVersion: integer('pin_version').notNull().default(1),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('user_friend_pins_user_friend_uq').on(
      table.userId,
      table.friendHandle,
    ),
  ],
)

export type UserFriendPin = typeof userFriendPins.$inferSelect
export type NewUserFriendPin = typeof userFriendPins.$inferInsert
