import Elysia, { t } from 'elysia'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { segmentStats } from '../schema/segment-stats.schema'
import { logger } from '../lib/logger'

/**
 * Anonymized segment-stats contribution relay (Part C.5d).
 *
 * Ops posture:
 * - Endpoint is UNAUTHENTICATED — the whole point is to not link the
 *   contribution to a user identity. The client sends no auth headers.
 * - No request logging at the controller level; the standard request
 *   logger SHOULD be configured to skip this path (see SECURITY.md
 *   §aggregates for deploy notes).
 * - No per-IP tracking beyond the platform-level rate limiter — that
 *   limiter IS the only thing keeping a single device from skewing the
 *   aggregate counts.
 * - Each request carries a batch of (segmentId, speedBucket, timeBucket)
 *   observations. The server increments counts; individual rows are
 *   never stored.
 *
 * A future hardening step (tracked in SECURITY.md) routes this endpoint
 * through an onion / zero-log relay so the server sees no source IP.
 */

const app = new Elysia()

const SPEED_BUCKETS_MAX = 50 // 0..49 → 0-499 km/h in 10 km/h buckets; plenty
const TIME_BUCKETS_MAX = 168 // 0..167 hour-of-week slots
const MAX_BATCH = 500

app.post(
  '/segment-stats/contribute',
  async ({ body, status }) => {
    if (!Array.isArray(body.observations)) {
      return status(400, { message: 'observations must be an array' })
    }
    if (body.observations.length === 0) return { accepted: 0 }
    if (body.observations.length > MAX_BATCH) {
      return status(400, { message: `batch too large (max ${MAX_BATCH})` })
    }

    let accepted = 0
    for (const obs of body.observations) {
      if (
        typeof obs.segmentId !== 'string' ||
        typeof obs.speedBucket !== 'number' ||
        typeof obs.timeBucket !== 'number'
      ) {
        continue
      }
      if (
        obs.speedBucket < 0 ||
        obs.speedBucket >= SPEED_BUCKETS_MAX ||
        obs.timeBucket < 0 ||
        obs.timeBucket >= TIME_BUCKETS_MAX ||
        obs.segmentId.length === 0 ||
        obs.segmentId.length > 128
      ) {
        continue
      }

      try {
        await db
          .insert(segmentStats)
          .values({
            segmentId: obs.segmentId,
            speedBucket: obs.speedBucket,
            timeBucket: obs.timeBucket,
            count: 1,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              segmentStats.segmentId,
              segmentStats.speedBucket,
              segmentStats.timeBucket,
            ],
            set: {
              count: sql`${segmentStats.count} + 1`,
              updatedAt: new Date(),
            },
          })
        accepted++
      } catch (err) {
        // Log only the error shape, never the contribution itself.
        logger.warn(
          { err: (err as Error).message },
          'segment-stats contribution write failed',
        )
      }
    }

    return { accepted }
  },
  {
    body: t.Object({
      observations: t.Array(
        t.Object({
          segmentId: t.String(),
          speedBucket: t.Number(),
          timeBucket: t.Number(),
        }),
      ),
    }),
    detail: {
      tags: ['SegmentStats'],
      description:
        'Anonymized contribution of bucketed segment observations (no auth, no logs)',
    },
  },
)

app.get(
  '/segment-stats/:segmentId',
  async ({ params: { segmentId } }) => {
    const rows = await db
      .select({
        speedBucket: segmentStats.speedBucket,
        timeBucket: segmentStats.timeBucket,
        count: segmentStats.count,
      })
      .from(segmentStats)
      .where(eq(segmentStats.segmentId, segmentId))

    return { segmentId, buckets: rows }
  },
  {
    params: t.Object({ segmentId: t.String() }),
    detail: {
      tags: ['SegmentStats'],
      description: 'Read aggregate counts for a segment (public, no auth)',
    },
  },
)

export default app
