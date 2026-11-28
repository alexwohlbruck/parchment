import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users.schema'

/** Clients that registered themselves (RFC 7591). All are public clients using PKCE. */
export const oauthClients = pgTable('oauth_clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  redirectUris: text('redirect_uris').array().notNull(),
  clientUri: text('client_uri'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const oauthAuthorizationCodes = pgTable('oauth_authorization_codes', {
  codeHash: text('code_hash').primaryKey(),
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClients.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  scopes: text('scopes').array().notNull(),
  resource: text('resource'),
  expiresAt: timestamp('expires_at').notNull(),
})

export type OAuthClient = typeof oauthClients.$inferSelect
export type NewOAuthClient = typeof oauthClients.$inferInsert
export type OAuthAuthorizationCode = typeof oauthAuthorizationCodes.$inferSelect
