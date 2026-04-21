import { relations } from 'drizzle-orm'
import { pgTable, text, timestamp, integer } from 'drizzle-orm/pg-core'
import { usersToRoles } from './users-roles.schema'
import { friendships } from './friendships.schema'
import { friendInvitations } from './friend-invitations.schema'
import { userPreferences } from './user-preferences.schema'

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  // Display name is metadata-encrypted at rest (Part C.4). The server stores
  // only opaque base64 v2 envelopes; only the user's own client can decrypt.
  // Admin and federation callers see null here.
  firstNameEncrypted: text('first_name_encrypted'),
  lastNameEncrypted: text('last_name_encrypted'),
  picture: text('picture'),
  alias: text('alias').unique(),              // Federation handle alias (unique per server)
  signingKey: text('signing_key'),            // Ed25519 public key (base64)
  encryptionKey: text('encryption_key'),      // X25519 public key (base64)
  // Master-key version (Part C.7). Every user-owned encrypted record stores
  // the kmVersion it was written under. On rotation, a background job re-
  // encrypts all rows and bumps this counter.
  kmVersion: integer('km_version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const usersRelations = relations(users, ({ one, many }) => ({
  usersToRoles: many(usersToRoles),
  friendships: many(friendships),
  friendInvitations: many(friendInvitations),
  preferences: one(userPreferences),
}))

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
