import {
  pgTable,
  text,
  timestamp,
  primaryKey,
} from 'drizzle-orm/pg-core'

/**
 * The id a place resolved to at an external provider (Google, Foursquare),
 * keyed by the place's own source id, so later lookups fetch it directly.
 */
export const placeProviderMatches = pgTable(
  'place_provider_matches',
  {
    source: text('source').notNull(),
    placeId: text('place_id').notNull(),
    provider: text('provider').notNull(),
    providerPlaceId: text('provider_place_id').notNull(),
    matchedAt: timestamp('matched_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.source, table.placeId, table.provider] }),
  ],
)

export type PlaceProviderMatch = typeof placeProviderMatches.$inferSelect
