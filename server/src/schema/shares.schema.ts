import { pgTable, text, timestamp, boolean, index, unique } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { users } from './users.schema'

/**
 * Generic shares table for E2EE resource sharing between users
 * Supports both same-server and cross-server sharing
 */
export const shares = pgTable(
  'shares',
  {
    id: text('id').primaryKey(),
    
    // Sender (local user)
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    
    // Recipient (can be local or remote)
    recipientHandle: text('recipient_handle').notNull(), // bob@other.com
    recipientUserId: text('recipient_user_id').references(() => users.id), // Optional, for local users
    
    // Resource being shared
    resourceType: text('resource_type').notNull(), // 'collection' | 'route' | 'map' | 'layer'
    resourceId: text('resource_id').notNull(),
    
    // Encrypted resource data (for cross-server sharing)
    encryptedData: text('encrypted_data'), // E2EE data blob
    nonce: text('nonce'),
    
    // Status
    status: text('status').default('pending').notNull(), // 'pending' | 'accepted' | 'rejected' | 'revoked'
    
    // Metadata
    createdAt: timestamp('created_at').defaultNow().notNull(),
    acceptedAt: timestamp('accepted_at'),
    expiresAt: timestamp('expires_at'),
  },
  (table) => [
    unique('unique_share').on(table.userId, table.recipientHandle, table.resourceType, table.resourceId),
    index('idx_shares_user').on(table.userId),
    index('idx_shares_recipient').on(table.recipientHandle),
    index('idx_shares_resource').on(table.resourceType, table.resourceId),
  ],
)

export type Share = typeof shares.$inferSelect
export type NewShare = typeof shares.$inferInsert

/**
 * Incoming shares from other users (including remote)
 */
export const incomingShares = pgTable(
  'incoming_shares',
  {
    id: text('id').primaryKey(),
    
    // Recipient (local user)
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    
    // Sender
    senderHandle: text('sender_handle').notNull(), // alex@parchment.app
    
    // Resource info
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    
    // Encrypted data (decryptable by recipient)
    encryptedData: text('encrypted_data').notNull(),
    nonce: text('nonce').notNull(),
    
    // Status
    status: text('status').default('pending').notNull(), // 'pending' | 'accepted' | 'rejected'
    
    // Signature from sender for verification
    signature: text('signature'),
    
    createdAt: timestamp('created_at').defaultNow().notNull(),
    acceptedAt: timestamp('accepted_at'),
  },
  (table) => [
    index('idx_incoming_shares_user').on(table.userId),
    index('idx_incoming_shares_sender').on(table.senderHandle),
  ],
)

export type IncomingShare = typeof incomingShares.$inferSelect
export type NewIncomingShare = typeof incomingShares.$inferInsert

// Relations
export const sharesRelations = relations(shares, ({ one }) => ({
  user: one(users, {
    fields: [shares.userId],
    references: [users.id],
  }),
  recipient: one(users, {
    fields: [shares.recipientUserId],
    references: [users.id],
  }),
}))

export const incomingSharesRelations = relations(incomingShares, ({ one }) => ({
  user: one(users, {
    fields: [incomingShares.userId],
    references: [users.id],
  }),
}))


