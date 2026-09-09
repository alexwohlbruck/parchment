import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { users } from './users.schema'

/**
 * Peer handles the user needs to notify that they've reset their E2EE
 * identity. Populated by `resetUserIdentity` immediately before the local
 * wipe so we preserve the list of friends / share counterparties (which
 * is about to disappear from the other tables) and can fan out
 * RELATIONSHIP_REVOKE messages once the user has re-registered keys.
 *
 * The server never fans these out on its own — the peer's inbox requires
 * a client-level Ed25519 signature over the v2 envelope, which the user
 * can only produce AFTER they've set up a new seed + uploaded new keys.
 * The `POST /users/me/revocations/flush` endpoint takes those signatures
 * and does the send, then deletes the rows. Any row that never gets
 * flushed (user abandons setup) survives forever — next session the
 * client picks up where it left off.
 *
 * Rows are purely operational; they carry no cryptographic material.
 */
export const pendingRevocations = pgTable(
  'pending_revocations',
  {
    id: text('id').primaryKey().notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    peerHandle: text('peer_handle').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('pending_revocations_user_peer_uq').on(
      t.userId,
      t.peerHandle,
    ),
  ],
)

export type PendingRevocation = typeof pendingRevocations.$inferSelect
export type NewPendingRevocation = typeof pendingRevocations.$inferInsert
