import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users.schema'

export enum IntegrationId {
  GOOGLE_MAPS = 'google-maps',
  PELIAS = 'pelias',
  OVERPASS = 'overpass',
  GRAPHHOPPER = 'graphhopper',
  YELP = 'yelp',
  OPENTABLE = 'opentable',
  FOURSQUARE = 'foursquare',
  MAPILLARY = 'mapillary',
  NOMINATIM = 'nominatim',
  TRIPADVISOR = 'tripadvisor',
  GEOAPIFY = 'geoapify',
  MAPBOX = 'mapbox',
}

export enum IntegrationCapabilityId {
  SEARCH = 'search',
  AUTOCOMPLETE = 'autocomplete',
  GEOCODING = 'geocoding',
  PLACE_INFO = 'placeInfo',
  ROUTING = 'routing',
  IMAGERY = 'imagery',
  MAP_ENGINE = 'mapEngine',
}

export const integrations = pgTable('integrations', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  integrationId: text('integration_id').$type<IntegrationId>().notNull(),
  config: text('config').$type<Record<string, any>>().notNull(), // JSON string
  capabilities: text('capabilities')
    .$type<
      {
        id: IntegrationCapabilityId
        active: boolean
      }[]
    >()
    .notNull(), // JSON string
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type IntegrationRecord = typeof integrations.$inferSelect
