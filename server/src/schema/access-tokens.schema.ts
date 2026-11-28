import { index, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users.schema'
import { oauthClients } from './oauth.schema'
import { ACCESS_TOKEN_KINDS } from '../types/access-token.types'

export const accessTokenKind = pgEnum('access_token_kind', ACCESS_TOKEN_KINDS)

/** Scoped bearer tokens: ones a user made in Settings, and grants to OAuth clients. */
export const accessTokens = pgTable(
  'access_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: accessTokenKind('kind').notNull(),
    name: text('name').notNull(),
    clientId: text('client_id').references(() => oauthClients.id, { onDelete: 'cascade' }),
    scopes: text('scopes').array().notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    hint: text('hint').notNull(),
    expiresAt: timestamp('expires_at'),
    refreshHash: text('refresh_hash').unique(),
    refreshExpiresAt: timestamp('refresh_expires_at'),
    lastUsedAt: timestamp('last_used_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [index('access_tokens_user_id_idx').on(table.userId)],
)

export type AccessToken = typeof accessTokens.$inferSelect
export type NewAccessToken = typeof accessTokens.$inferInsert
