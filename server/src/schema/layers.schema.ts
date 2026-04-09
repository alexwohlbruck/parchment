import {
  pgTable,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
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

export const LayerCategory = {
  CORE: 'core',
  DEFAULT: 'default',
  CUSTOM: 'custom',
} as const

export type LayerType = (typeof LayerType)[keyof typeof LayerType]
export type MapEngine = (typeof MapEngine)[keyof typeof MapEngine]
export type LayerCategory = (typeof LayerCategory)[keyof typeof LayerCategory]

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
  groupId: text('group_id').references(() => layerGroups.id, {
    onDelete: 'set null',
  }),
  configuration: jsonb('configuration').notNull(),
  // New unified layer model fields
  category: text('category', { enum: Object.values(LayerCategory) })
    .notNull()
    .default(LayerCategory.CUSTOM),
  defaultTemplateId: text('default_template_id'),
  isSubLayer: boolean('is_sub_layer').notNull().default(false),
  enabled: boolean('enabled').notNull().default(true),
  integrationId: text('integration_id'),
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
  // New unified layer model fields
  category: text('category', { enum: Object.values(LayerCategory) })
    .notNull()
    .default(LayerCategory.CUSTOM),
  defaultTemplateId: text('default_template_id'),
  parentGroupId: text('parent_group_id'),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type Layer = typeof layers.$inferSelect
export type LayerGroup = typeof layerGroups.$inferSelect
export type NewLayer = typeof layers.$inferInsert
export type NewLayerGroup = typeof layerGroups.$inferInsert
