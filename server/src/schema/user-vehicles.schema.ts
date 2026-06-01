import { relations } from 'drizzle-orm'
import { pgTable, text, timestamp, boolean, doublePrecision, index } from 'drizzle-orm/pg-core'
import { users } from './users.schema'

export const userVehicles = pgTable('user_vehicles', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // VehicleType: car, bike, scooter, etc.
  energyType: text('energy_type'), // EnergyType: electric, gas, diesel, hybrid
  name: text('name'), // User label, e.g. "Blue Honda"
  isActive: boolean('is_active').notNull().default(false),
  lastKnownLat: doublePrecision('last_known_lat'),
  lastKnownLng: doublePrecision('last_known_lng'),
  locationSource: text('location_source').notNull().default('manual'), // 'manual' | 'inferred' | 'tracker'
  locationUpdatedAt: timestamp('location_updated_at'),
  trackerDeviceId: text('tracker_device_id'), // Future: FK to tracked_devices
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('user_vehicles_user_id_idx').on(table.userId),
])

export const userVehiclesRelations = relations(userVehicles, ({ one }) => ({
  user: one(users, {
    fields: [userVehicles.userId],
    references: [users.id],
  }),
}))

export type UserVehicle = typeof userVehicles.$inferSelect
export type NewUserVehicle = typeof userVehicles.$inferInsert
