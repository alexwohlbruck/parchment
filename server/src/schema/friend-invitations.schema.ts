import { relations } from 'drizzle-orm'
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users.schema'

export const friendInvitations = pgTable('friend_invitations', {
  id: text('id').primaryKey(),
  fromHandle: text('from_handle').notNull(),              // "alex@parchment.app"
  toHandle: text('to_handle').notNull(),                  // "bob@other.com"
  localUserId: text('local_user_id').references(() => users.id, { onDelete: 'cascade' }),  // FK to local user (sender or recipient)
  direction: text('direction').notNull(),                 // 'outgoing' | 'incoming'
  status: text('status').notNull().default('pending'),    // pending, accepted, rejected, cancelled
  originServer: text('origin_server').notNull(),          // Server that initiated
  signature: text('signature'),                           // Ed25519 signature from sender
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at'),
})

export const friendInvitationsRelations = relations(friendInvitations, ({ one }) => ({
  localUser: one(users, {
    fields: [friendInvitations.localUserId],
    references: [users.id],
  }),
}))

export type FriendInvitation = typeof friendInvitations.$inferSelect
export type NewFriendInvitation = typeof friendInvitations.$inferInsert

// Invitation direction types
export type InvitationDirection = 'outgoing' | 'incoming'

// Invitation status types
export type InvitationStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled'


