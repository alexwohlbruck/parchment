import {
  pgTable,
  text,
  timestamp,
  jsonb,
  boolean,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { users } from './user.schema'

export const bookmarks = pgTable('saved_places', {
  id: text('id').primaryKey().notNull(),
  externalIds: jsonb('external_ids').notNull(), // Store OSM ID and possibly other provider IDs
  name: text('name').notNull(),
  address: text('address'),
  icon: text('icon').notNull().default('map-pin'),
  iconColor: text('icon_color').notNull().default('#F43F5E'),
  presetType: text('preset_type'),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const collections = pgTable('collections', {
  id: text('id').primaryKey().notNull(),
  name: text('name'),
  description: text('description'),
  icon: text('icon').notNull().default('folder'),
  iconColor: text('icon_color').notNull().default('#3B82F6'),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  isPublic: boolean('is_public').default(false).notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const placesCollections = pgTable(
  'places_collections',
  {
    placeId: text('place_id')
      .notNull()
      .references(() => bookmarks.id, { onDelete: 'cascade' }),
    collectionId: text('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at').defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.placeId, t.collectionId] }),
  }),
)
