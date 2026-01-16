import { relations } from 'drizzle-orm'
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  index,
  unique,
} from 'drizzle-orm/pg-core'
import { users } from './users.schema'
import { integrations } from './integrations.schema'

// ============================================================================
// User Encryption Keys - For E2E encryption
// ============================================================================

export const userEncryptionKeys = pgTable('user_encryption_key', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  publicKey: text('public_key').notNull(), // Ed25519 public key (base64-encoded)
  keyVersion: integer('key_version').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type UserEncryptionKey = typeof userEncryptionKeys.$inferSelect
export type NewUserEncryptionKey = typeof userEncryptionKeys.$inferInsert

// ============================================================================
// User Devices - User's own devices (not third-party tracked devices)
// ============================================================================

export const userDevices = pgTable(
  'user_device',
  {
    id: text('id').primaryKey(), // Unique device identifier (generated on first app launch)
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    fingerprint: text('fingerprint').notNull(), // Stable device fingerprint for deduplication
    deviceName: text('device_name').notNull(), // User-friendly name (e.g., "iPhone 15", "MacBook Pro")
    deviceType: text('device_type').notNull(), // 'ios' | 'android' | 'desktop' | 'web'
    isPrimary: boolean('is_primary').default(false).notNull(), // True if this is the primary device for location sharing
    lastSeenAt: timestamp('last_seen_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_user_devices_user_id').on(table.userId),
    unique('unique_user_device_fingerprint').on(
      table.userId,
      table.fingerprint,
    ),
  ],
)

export type UserDevice = typeof userDevices.$inferSelect
export type NewUserDevice = typeof userDevices.$inferInsert

// ============================================================================
// Location Sharing Relationships
// ============================================================================

export const locationSharingRelationships = pgTable(
  'location_sharing_relationship',
  {
    id: text('id').primaryKey(),
    sharerId: text('sharer_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    sharerServerUrl: text('sharer_server_url'), // For cross-server relationships
    viewerId: text('viewer_id').references(() => users.id, {
      onDelete: 'cascade',
    }), // Nullable if cross-server
    viewerServerUrl: text('viewer_server_url'), // For cross-server relationships
    viewerFederatedId: text('viewer_federated_id'), // Format: user@server.com
    status: text('status').default('pending').notNull(), // 'pending' | 'active' | 'blocked' | 'expired'
    isCrossServer: boolean('is_cross_server').default(false).notNull(),
    sharedKeyEncrypted: text('shared_key_encrypted'), // Encrypted shared key (encrypted with viewer's public key)
    keyExchangeVersion: integer('key_exchange_version').default(1).notNull(),
    expiresAt: timestamp('expires_at'), // Null for indefinite sharing, timestamp for time-limited
    sharedProperties: jsonb('shared_properties')
      .$type<{
        speed?: boolean
        activityType?: boolean
        altitude?: boolean
        course?: boolean
      }>()
      .default({
        speed: true,
        activityType: true,
        altitude: true,
        course: true,
      }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('unique_sharing_relationship').on(
      table.sharerId,
      table.viewerId,
      table.viewerFederatedId,
    ),
    index('idx_sharing_sharer').on(table.sharerId),
    index('idx_sharing_viewer').on(table.viewerId),
    index('idx_sharing_status').on(table.status),
  ],
)

export type LocationSharingRelationship =
  typeof locationSharingRelationships.$inferSelect
export type NewLocationSharingRelationship =
  typeof locationSharingRelationships.$inferInsert

// ============================================================================
// Location Events - Encrypted location storage (history log)
// ============================================================================

export const locationEvents = pgTable(
  'location_event',
  {
    id: text('id').primaryKey(), // UUID v7
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    relationshipId: text('relationship_id')
      .references(() => locationSharingRelationships.id, {
        onDelete: 'cascade',
      })
      .notNull(),
    encryptedData: text('encrypted_data').notNull(), // Base64-encoded encrypted JSON of full location event
    encryptionVersion: integer('encryption_version').default(1).notNull(),
    entityType: text('entity_type').default('person').notNull(), // 'person' | 'device'
    entityId: text('entity_id'), // ID of tracked device if entity_type is 'device'
    approximateTimestamp: timestamp('approximate_timestamp').notNull(), // Rounded to nearest minute for queries
    approximateLat: numeric('approximate_lat', { precision: 10, scale: 4 }), // ~100m precision
    approximateLng: numeric('approximate_lng', { precision: 10, scale: 4 }), // ~100m precision
    trackingMode: text('tracking_mode').default('battery-efficient').notNull(), // 'high-accuracy' | 'battery-efficient'
    deviceId: text('device_id').references(() => userDevices.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_location_user_relationship_timestamp').on(
      table.userId,
      table.relationshipId,
      table.approximateTimestamp,
    ),
    index('idx_location_user_timestamp').on(
      table.userId,
      table.approximateTimestamp,
    ),
    index('idx_location_entity').on(table.entityType, table.entityId),
  ],
)

export type LocationEvent = typeof locationEvents.$inferSelect
export type NewLocationEvent = typeof locationEvents.$inferInsert

// ============================================================================
// Tracked Devices - Third-party device tracking (Tile, cars, etc.)
// ============================================================================

export const trackedDevices = pgTable(
  'tracked_device',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    integrationId: text('integration_id')
      .references(() => integrations.id, { onDelete: 'cascade' })
      .notNull(),
    deviceType: text('device_type').notNull(), // 'tile' | 'car' | 'bike' | 'airtag' | 'custom'
    deviceName: text('device_name').notNull(), // User-friendly name (e.g., "My Car", "Keys")
    externalDeviceId: text('external_device_id').notNull(), // ID from the third-party service
    icon: text('icon').default('map-pin').notNull(),
    iconColor: text('icon_color').default('#3B82F6').notNull(),
    isShared: boolean('is_shared').default(true).notNull(), // Whether to show on map alongside people's locations
    config: jsonb('config').$type<Record<string, any>>().default({}),
    lastSeenAt: timestamp('last_seen_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_tracked_devices_user').on(table.userId),
    index('idx_tracked_devices_integration').on(table.integrationId),
  ],
)

export type TrackedDevice = typeof trackedDevices.$inferSelect
export type NewTrackedDevice = typeof trackedDevices.$inferInsert

// ============================================================================
// Location Sharing Config (Federation-based) - Who can see your location
// ============================================================================

export const locationSharingConfig = pgTable(
  'location_sharing_config',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    friendHandle: text('friend_handle').notNull(), // bob@other.com
    enabled: boolean('enabled').default(true).notNull(),
    refreshInterval: integer('refresh_interval').default(60).notNull(), // seconds
    expiresAt: timestamp('expires_at'), // optional auto-expire
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('unique_location_config').on(table.userId, table.friendHandle),
    index('idx_location_config_user').on(table.userId),
  ],
)

export type LocationSharingConfig = typeof locationSharingConfig.$inferSelect
export type NewLocationSharingConfig = typeof locationSharingConfig.$inferInsert

// ============================================================================
// Encrypted Locations Cache - Current location encrypted per-friend
// ============================================================================

export const encryptedLocations = pgTable(
  'encrypted_locations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    forFriendHandle: text('for_friend_handle').notNull(), // Recipient's handle
    encryptedLocation: text('encrypted_location').notNull(), // E2EE with friend's shared secret
    nonce: text('nonce').notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('unique_encrypted_location').on(table.userId, table.forFriendHandle),
    index('idx_encrypted_location_user').on(table.userId),
  ],
)

export type EncryptedLocation = typeof encryptedLocations.$inferSelect
export type NewEncryptedLocation = typeof encryptedLocations.$inferInsert

// ============================================================================
// Location History (Personal) - Encrypted with personal key
// ============================================================================

export const locationHistory = pgTable(
  'location_history',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    encryptedLocation: text('encrypted_location').notNull(), // E2EE with personal key
    nonce: text('nonce').notNull(),
    timestamp: timestamp('timestamp').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_location_history_user_time').on(table.userId, table.timestamp),
  ],
)

export type LocationHistory = typeof locationHistory.$inferSelect
export type NewLocationHistory = typeof locationHistory.$inferInsert

// ============================================================================
// Federated Servers - For cross-server federation
// ============================================================================

export const federatedServers = pgTable('federated_server', {
  id: text('id').primaryKey(),
  serverUrl: text('server_url').notNull().unique(), // Base URL of federated server
  serverName: text('server_name'), // Human-readable name
  publicKey: text('public_key'), // For server-to-server authentication
  verified: boolean('verified').default(false).notNull(),
  lastContactedAt: timestamp('last_contacted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type FederatedServer = typeof federatedServers.$inferSelect
export type NewFederatedServer = typeof federatedServers.$inferInsert

// ============================================================================
// Relations
// ============================================================================

export const userEncryptionKeysRelations = relations(
  userEncryptionKeys,
  ({ one }) => ({
    user: one(users, {
      fields: [userEncryptionKeys.userId],
      references: [users.id],
    }),
  }),
)

export const userDevicesRelations = relations(userDevices, ({ one }) => ({
  user: one(users, {
    fields: [userDevices.userId],
    references: [users.id],
  }),
}))

export const locationSharingRelationshipsRelations = relations(
  locationSharingRelationships,
  ({ one, many }) => ({
    sharer: one(users, {
      fields: [locationSharingRelationships.sharerId],
      references: [users.id],
      relationName: 'sharer',
    }),
    viewer: one(users, {
      fields: [locationSharingRelationships.viewerId],
      references: [users.id],
      relationName: 'viewer',
    }),
    locationEvents: many(locationEvents),
  }),
)

export const locationEventsRelations = relations(locationEvents, ({ one }) => ({
  user: one(users, {
    fields: [locationEvents.userId],
    references: [users.id],
  }),
  relationship: one(locationSharingRelationships, {
    fields: [locationEvents.relationshipId],
    references: [locationSharingRelationships.id],
  }),
  device: one(userDevices, {
    fields: [locationEvents.deviceId],
    references: [userDevices.id],
  }),
}))

export const trackedDevicesRelations = relations(trackedDevices, ({ one }) => ({
  user: one(users, {
    fields: [trackedDevices.userId],
    references: [users.id],
  }),
  integration: one(integrations, {
    fields: [trackedDevices.integrationId],
    references: [integrations.id],
  }),
}))

export const locationSharingConfigRelations = relations(
  locationSharingConfig,
  ({ one }) => ({
    user: one(users, {
      fields: [locationSharingConfig.userId],
      references: [users.id],
    }),
  }),
)

export const encryptedLocationsRelations = relations(
  encryptedLocations,
  ({ one }) => ({
    user: one(users, {
      fields: [encryptedLocations.userId],
      references: [users.id],
    }),
  }),
)

export const locationHistoryRelations = relations(
  locationHistory,
  ({ one }) => ({
    user: one(users, {
      fields: [locationHistory.userId],
      references: [users.id],
    }),
  }),
)
