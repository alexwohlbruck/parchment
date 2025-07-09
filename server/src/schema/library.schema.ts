import {
  pgTable,
  text,
  timestamp,
  jsonb,
  boolean,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { users } from './users.schema'
import { pointGeometry, spatialIndex, trigramIndex } from './spatial-helpers'

export const bookmarks = pgTable(
  'bookmarks',
  {
    id: text('id').primaryKey().notNull(),
    externalIds: jsonb('external_ids').notNull(), // Store OSM ID and possibly other provider IDs
    name: text('name').notNull(),
    address: text('address'),
    geometry: pointGeometry('geometry').notNull(),
    icon: text('icon').notNull().default('map-pin'),
    iconColor: text('icon_color').notNull().default('#F43F5E'),
    presetType: text('preset_type'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    // TODO: Review indexes techniques, performance
    // Spatial index for geometry queries
    geometryIdx: spatialIndex('idx_bookmarks_geometry', table.geometry),
    // Trigram indexes for fuzzy text search using pg_trgm
    nameTrigramIdx: trigramIndex('idx_bookmarks_name_trgm', table.name),
    addressTrigramIdx: trigramIndex(
      'idx_bookmarks_address_trgm',
      table.address,
    ),
    presetTrigramIdx: trigramIndex(
      'idx_bookmarks_preset_trgm',
      table.presetType,
    ),
  }),
)

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

export const bookmarksCollections = pgTable(
  'bookmarks_collections',
  {
    bookmarkId: text('bookmark_id')
      .notNull()
      .references(() => bookmarks.id, { onDelete: 'cascade' }),
    collectionId: text('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at').defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.bookmarkId, t.collectionId] }),
  }),
)

export type Bookmark = typeof bookmarks.$inferSelect
export type Collection = typeof collections.$inferSelect
export type BookmarkCollection = typeof bookmarksCollections.$inferSelect
