import { pgTable, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { users } from './users.schema'

/**
 * Persisted trip-plan snapshots, addressed by a random capability token in
 * the trip URL (`?pt=<id>` — like an unlisted link).
 *
 * Why a snapshot and not a re-plan: transit schedules and GBFS availability
 * drift, so re-running the planner can't faithfully reproduce a trip the
 * user looked at an hour ago. The snapshot makes refresh and cross-device
 * shares deterministic; the client still re-plans for live alternatives.
 *
 * Rows are small (one chosen trip, not the whole result set) and expire —
 * reads past `expiresAt` 404 and delete the row opportunistically.
 */
export const plannedTrips = pgTable(
  'planned_trips',
  {
    /** URL token. 16 hex chars of CSPRNG — unguessable, not enumerable. */
    id: text('id').primaryKey(),
    /** Optional owner (when the request carried a session). */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Planning inputs (waypoints/mode/sort/depart) for re-planning. */
    request: jsonb('request').notNull(),
    /** The chosen trip exactly as the client rendered it. */
    trip: jsonb('trip').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => [index('idx_planned_trips_expires').on(table.expiresAt)],
)

export type PlannedTrip = typeof plannedTrips.$inferSelect
export type NewPlannedTrip = typeof plannedTrips.$inferInsert
