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

export const LayerType = {
  CUSTOM: 'custom',
  STREET_VIEW: 'street_view',
  TRANSIT: 'transit',
} as const

export const MapEngine = {
  MAPBOX: 'mapbox',
  MAPLIBRE: 'maplibre',
} as const

export type LayerType = (typeof LayerType)[keyof typeof LayerType]
export type MapEngine = (typeof MapEngine)[keyof typeof MapEngine]

export const layers = pgTable('layers', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
  type: text('type', { enum: Object.values(LayerType) })
    .notNull()
    .default(LayerType.CUSTOM),
  engine: text('engine', { enum: Object.values(MapEngine) })
    .array()
    .notNull()
    .default([MapEngine.MAPBOX, MapEngine.MAPLIBRE]),
  showInLayerSelector: boolean('show_in_layer_selector')
    .notNull()
    .default(true),
  visible: boolean('visible').notNull().default(true),
  fadeBasemap: boolean('fade_basemap').notNull().default(false),
  icon: text('icon'),
  order: integer('order').notNull(),
  groupId: text('group_id'),
  configuration: jsonb('configuration').notNull(),
  isSubLayer: boolean('is_sub_layer').notNull().default(false),
  enabled: boolean('enabled').notNull().default(true),
  integrationId: text('integration_id'),
  // Informational: set when this row is a user clone of a default template.
  // Clones are fully user-owned; this field is NOT consulted at read time.
  clonedFromTemplateId: text('cloned_from_template_id'),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const layerGroups = pgTable('layer_groups', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
  showInLayerSelector: boolean('show_in_layer_selector')
    .notNull()
    .default(true),
  visible: boolean('visible').notNull().default(true),
  fadeBasemap: boolean('fade_basemap').notNull().default(false),
  icon: text('icon'),
  order: integer('order').notNull(),
  parentGroupId: text('parent_group_id'),
  integrationId: text('integration_id'),
  clonedFromTemplateId: text('cloned_from_template_id'),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * Sidecar table storing the user's preferences for default (template-backed)
 * layers and groups WITHOUT cloning them. Used for light overrides:
 *   - visibility toggles
 *   - ordering
 *   - enabled flag
 *   - parent/group re-parenting
 *   - tombstone (`hidden`) when the user deletes or replaces a default via clone
 *
 * Primary key: (userId, templateId, type).
 * NULL in an override column means "use the template's value".
 */
export const defaultLayerUserState = pgTable(
  'default_layer_user_state',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    templateId: text('template_id').notNull(),
    type: text('type', { enum: ['layer', 'group'] as const }).notNull(),
    hidden: boolean('hidden').notNull().default(false),
    visible: boolean('visible'),
    order: integer('order'),
    enabled: boolean('enabled'),
    groupId: text('group_id'),
    parentGroupId: text('parent_group_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({
      name: 'default_layer_user_state_pkey',
      columns: [table.userId, table.templateId, table.type],
    }),
  }),
)

export type Layer = typeof layers.$inferSelect
export type LayerGroup = typeof layerGroups.$inferSelect
export type NewLayer = typeof layers.$inferInsert
export type NewLayerGroup = typeof layerGroups.$inferInsert
export type DefaultLayerUserState = typeof defaultLayerUserState.$inferSelect
export type NewDefaultLayerUserState = typeof defaultLayerUserState.$inferInsert
