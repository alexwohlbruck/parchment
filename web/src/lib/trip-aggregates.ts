/**
 * Trip → anonymized segment observations (Part C.5d).
 *
 * This module converts a completed trip into the fixed-size records the
 * community aggregate endpoint accepts. Trips themselves stay client-local
 * and are not persisted server-side.
 *
 * Privacy properties enforced here:
 * - Every observation is `(segmentId, speedBucket, timeBucket)` and NOTHING
 *   else. No timestamps, no user id, no trip id, no coordinates, no ordering
 *   signal in the output array (the caller uploads in a batch; server
 *   cannot reconstruct trip geometry from random-ordered contributions).
 * - Buckets are coarse by design: 10 km/h speed, hour-of-week time.
 * - Output is shuffled before upload so the ordering within the batch does
 *   not leak the trip sequence.
 *
 * Contribution is OPT-IN. This module does not upload — the caller decides.
 */

const SPEED_BUCKET_KMH = 10
const MAX_SPEED_BUCKET = 50 // must match server controller's cap

export interface TripSegmentObservation {
  /** OSM way id or internal segment id — whatever the trip data engine emitted. */
  segmentId: string
  /** Observed average speed in km/h over that segment. */
  avgSpeedKmh: number
  /** Unix ms when the segment was traversed. */
  observedAt: number
}

export interface AnonymizedObservation {
  segmentId: string
  speedBucket: number
  timeBucket: number
}

/**
 * Bucket a single observation. Clamps out-of-range values to the edges so
 * garbage input becomes a benign "fastest" or "slowest" bucket rather than
 * throwing.
 */
export function bucketObservation(
  obs: TripSegmentObservation,
): AnonymizedObservation {
  const speed = Math.max(0, obs.avgSpeedKmh)
  let speedBucket = Math.floor(speed / SPEED_BUCKET_KMH)
  if (speedBucket >= MAX_SPEED_BUCKET) speedBucket = MAX_SPEED_BUCKET - 1

  const date = new Date(obs.observedAt)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid observedAt: ${obs.observedAt}`)
  }
  // Hour-of-week: (dayOfWeek * 24 + hourOfDay), in UTC to keep it
  // timezone-independent. 0 = Sunday 00:00 UTC, 167 = Saturday 23:00 UTC.
  const timeBucket = date.getUTCDay() * 24 + date.getUTCHours()

  return {
    segmentId: obs.segmentId,
    speedBucket,
    timeBucket,
  }
}

/**
 * Convert a trip's segments into an anonymized, shuffled batch of
 * observations suitable for the contribute endpoint.
 *
 * Dedupes identical (segmentId, speedBucket, timeBucket) triples within
 * a single trip to avoid one driver's stuck-in-traffic segment pumping
 * the count disproportionately.
 */
export function anonymizeTrip(
  segments: TripSegmentObservation[],
): AnonymizedObservation[] {
  const seen = new Set<string>()
  const out: AnonymizedObservation[] = []

  for (const seg of segments) {
    if (!seg.segmentId || seg.segmentId.length > 128) continue
    const bucketed = bucketObservation(seg)
    const key = `${bucketed.segmentId}|${bucketed.speedBucket}|${bucketed.timeBucket}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(bucketed)
  }

  // Shuffle via Fisher-Yates to drop any trip-order signal.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }

  return out
}

/**
 * Upload the anonymized batch. Caller should check the user's opt-in
 * preference before invoking — this function does not consult any
 * settings state.
 */
export async function uploadAggregateObservations(
  observations: AnonymizedObservation[],
  options: { relayUrl: string } = { relayUrl: '/segment-stats/contribute' },
): Promise<{ accepted: number }> {
  if (observations.length === 0) return { accepted: 0 }
  const response = await fetch(options.relayUrl, {
    method: 'POST',
    // Deliberately no auth header, no cookies — this endpoint is
    // unauthenticated by design. Server still sees source IP; deployment
    // should route via a zero-log relay (see SECURITY.md §aggregates).
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ observations }),
  })
  if (!response.ok) {
    throw new Error(
      `segment-stats upload failed: ${response.status} ${response.statusText}`,
    )
  }
  return (await response.json()) as { accepted: number }
}
