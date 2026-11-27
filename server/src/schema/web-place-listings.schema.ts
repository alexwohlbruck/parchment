import { pgTable, pgEnum, text, jsonb, timestamp, bigint } from 'drizzle-orm/pg-core'
import { users } from './users.schema'
import type { Place } from '../types/place.types'

export const webPlaceListingResolution = pgEnum('web_place_listing_resolution', [
  'added',
  'noted',
  'auto-noted',
  'mapped',
  'already-noted',
  'no-account',
  'failed',
])

/**
 * Places found on their own website that the map doesn't have, kept while
 * they can be opened. One left unresolved when it expires gets an OSM note.
 */
export const webPlaceListings = pgTable('web_place_listings', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  place: jsonb('place').notNull().$type<Place>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  resolvedAt: timestamp('resolved_at'),
  resolution: webPlaceListingResolution('resolution'),
  noteId: bigint('note_id', { mode: 'number' }),
})

export type WebPlaceListing = typeof webPlaceListings.$inferSelect
