import {
  pgTable,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
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
  isSensitive: boolean('is_sensitive').default(false).notNull(), // E2EE sensitive mode (legacy)
  // Part C.5c: encrypted metadata envelope (base64 v2 crypto-envelope).
  // When populated, this supersedes the cleartext columns above. Migration
  // to drop the cleartext columns happens once all UI consumers read the
  // decrypted envelope.
  metadataEncrypted: text('metadata_encrypted'),
  metadataKeyVersion: integer('metadata_key_version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * Custom canvases — user-created map overlays (future collab feature).
 * Fully encrypted from day 1. Metadata (name, description, style) lives
 * in the envelope; body content lives in a separate encrypted_canvas_state
 * table (not in this PR).
 *
 * Multi-user collab (sealing the canvas key to collaborators' X25519 pubs
 * via ECIES) is tracked as a follow-up — see SECURITY.md §canvases.
 */
export const canvases = pgTable('canvases', {
  id: text('id').primaryKey().notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  metadataEncrypted: text('metadata_encrypted').notNull(),
  metadataKeyVersion: integer('metadata_key_version').notNull().default(1),
  // Reserved for future Yjs / CRDT document format version; not in use yet.
  futureCrdtFormatVersion: integer('future_crdt_format_version'),
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

// Encrypted points for sensitive collections
// These are E2EE and cannot be searched server-side
export const encryptedPoints = pgTable('encrypted_points', {
  id: text('id').primaryKey().notNull(),
  collectionId: text('collection_id')
    .notNull()
    .references(() => collections.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  encryptedData: text('encrypted_data').notNull(), // E2EE JSON with name, location, icon, etc.
  nonce: text('nonce').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type Bookmark = typeof bookmarks.$inferSelect
export type Collection = typeof collections.$inferSelect
export type BookmarkCollection = typeof bookmarksCollections.$inferSelect
export type EncryptedPoint = typeof encryptedPoints.$inferSelect
export type Canvas = typeof canvases.$inferSelect
