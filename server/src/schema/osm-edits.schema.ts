import {
  pgTable,
  pgEnum,
  text,
  integer,
  jsonb,
  doublePrecision,
  timestamp,
} from 'drizzle-orm/pg-core'
import { users } from './users.schema'

export const osmEditAction = pgEnum('osm_edit_action', ['create', 'modify'])

/**
 * Quick edits submitted to OpenStreetMap through the app. Rows stay
 * unresolved until the upstream data import catches up with the edit,
 * letting the client surface "pending map update" state.
 */
export const osmEdits = pgTable('osm_edits', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  action: osmEditAction('action').notNull(),
  osmType: text('osm_type').notNull(),
  osmId: text('osm_id').notNull(),
  version: integer('version'),
  changesetId: text('changeset_id').notNull(),
  tags: jsonb('tags').notNull().$type<Record<string, string>>(),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  comment: text('comment'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at'),
})

export type OsmEdit = typeof osmEdits.$inferSelect
export type NewOsmEdit = typeof osmEdits.$inferInsert
