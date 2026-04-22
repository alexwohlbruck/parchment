import { relations } from 'drizzle-orm'
import { pgTable, text, timestamp, integer } from 'drizzle-orm/pg-core'
import { usersToRoles } from './users-roles.schema'
import { friendships } from './friendships.schema'
import { friendInvitations } from './friend-invitations.schema'
import { userPreferences } from './user-preferences.schema'

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  // Display names are intentionally cleartext: they're not sensitive and
  // they're used by federation peers, friends, and admin surfaces to show
  // who a user is. If you need to protect a specific user's real name, use
  // an alias instead. See SECURITY.md for the scope of what IS encrypted.
  firstName: text('first_name'),
  lastName: text('last_name'),
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
