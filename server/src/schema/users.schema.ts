import { relations } from 'drizzle-orm'
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { usersToRoles } from './users-roles.schema'
import { friendships } from './friendships.schema'
import { friendInvitations } from './friend-invitations.schema'
import { userPreferences } from './user-preferences.schema'

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  picture: text('picture'),
  alias: text('alias').unique(),              // Federation handle alias (unique per server)
  signingKey: text('signing_key'),            // Ed25519 public key (base64)
  encryptionKey: text('encryption_key'),      // X25519 public key (base64)
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
