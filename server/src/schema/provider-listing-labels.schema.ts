import { pgTable, text, timestamp, primaryKey } from 'drizzle-orm/pg-core'

/**
 * Display names for provider listings that can't be looked up for free by id,
 * such as a Google Hotels property token, which costs a paid search to resolve.
 */
export const providerListingLabels = pgTable(
  'provider_listing_labels',
  {
    provider: text('provider').notNull(),
    providerPlaceId: text('provider_place_id').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerPlaceId] })],
)

export type ProviderListingLabelRow = typeof providerListingLabels.$inferSelect
