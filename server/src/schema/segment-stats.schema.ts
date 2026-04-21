import {
  pgTable,
  text,
  integer,
  timestamp,
  primaryKey,
} from 'drizzle-orm/pg-core'

/**
 * Anonymized aggregate segment statistics (Part C.5d).
 *
 * Each row counts how many times an (OSM way or segment, speed bucket,
 * time-of-week bucket) tuple has been observed across the community of
 * opted-in contributors. Individual contributions are NEVER persisted —
 * only the running counts. No userId, no tripId, no timestamp of
 * individual observations, no geometry beyond the segment id itself.
 *
 * See SECURITY.md §aggregates for the ops posture.
 */
export const segmentStats = pgTable(
  'segment_stats',
  {
    segmentId: text('segment_id').notNull(), // OSM way id or internal segment id
    speedBucket: integer('speed_bucket').notNull(), // 10 km/h buckets → 0=0-9, 1=10-19, …
    timeBucket: integer('time_bucket').notNull(), // hour-of-week: 0..167
    count: integer('count').notNull().default(0),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.segmentId, t.speedBucket, t.timeBucket],
    }),
  ],
)

export type SegmentStat = typeof segmentStats.$inferSelect
