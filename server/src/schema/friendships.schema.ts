import { relations } from 'drizzle-orm'
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users.schema'

export const friendships = pgTable('friendships', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  friendHandle: text('friend_handle').notNull(), // Full handle: "bob@other.com"
  friendSigningKey: text('friend_signing_key'), // Cached Ed25519 public key
  friendEncryptionKey: text('friend_encryption_key'), // Cached X25519 public key
  friendName: text('friend_name'), // Cached display name
  friendPicture: text('friend_picture'), // Cached avatar URL
  status: text('status').notNull().default('accepted'), // accepted, blocked
  establishedAt: timestamp('established_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const friendshipsRelations = relations(friendships, ({ one }) => ({
  user: one(users, {
    fields: [friendships.userId],
    references: [users.id],
  }),
}))

export type Friendship = typeof friendships.$inferSelect
export type NewFriendship = typeof friendships.$inferInsert
