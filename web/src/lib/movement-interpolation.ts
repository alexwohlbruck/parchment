/**
 * Movement interpolation — receiver-side dead reckoning for friend
 * markers.
 *
 * Friends broadcast their position every 10s+ (movement-driven), but the
 * receiver wants the marker to glide smoothly between updates instead of
 * teleporting. This module is the math layer: pure functions that
 * compute predicted positions from the latest sample plus elapsed time.
 *
 * The strategy is "tween-then-dead-reckon":
 *
 *   1. When a new sample arrives, animate FROM the currently-rendered
 *      position TO the new sample over a short tween (200-1000ms,
 *      proportional to the visible jump). Smooth handoff that hides
 *      the snap when reality differs from prediction.
 *   2. After the tween completes, dead-reckon forward from the sample
 *      using the sample's `speed` and `heading`, capped at
 *      `STALENESS_CAP_SEC` so we don't extrapolate into nonsense if the
 *      sender goes offline.
 *
 * Apple's Find My uses something similar on the receiver side per public
 * reverse-engineering (CV dead reckoning + a small smoother). We're
 * doing the simpler "linear + ease-out" version; Kalman / spline are a
 * later phase.
 *
 * Owned by `FriendLocationsLayer`; tests live next to this file.
 */

import type { LngLat } from '@/types/map.types'

/** A single per-friend animation state. Mutated as new samples arrive. */
export interface Track {
  /** Where the segment starts. The previously-rendered position. */
  from: LngLat
  /** Where the segment ends. The latest sample's position. */
  to: LngLat
  /** Wall-clock ms when the segment began (when the sample arrived). */
  segmentStartMs: number
  /**
   * Tween length. 0 for the first sample (no `from` to glide from);
   * otherwise scaled to the visible jump distance — small corrections
   * tween fast, big snaps tween a bit slower.
   */
  segmentDurationMs: number
  /**
   * Velocity at the START of the segment, derived from the previous
   * sample's reported speed/heading. Used as the entry tangent for the
   * Hermite cubic — without it the segment would have a kink at
   * `from` (sudden direction change). null on the very first sample
   * for a friend or when the prior sample had no usable speed.
   */
  fromVelocity: { speedMps: number; headingDeg: number } | null
  /** m/s, from the latest sample's `LocationData.speed`. */
  postSpeed: number | null
  /**
   * Degrees, 0=N, 90=E. From `LocationData.heading`. Undefined when the
   * sender's device couldn't compute heading (stationary, indoor).
   */
  postHeading: number | null
  /**
   * The sample's `updatedAt` time as ms since epoch. Used to dedup
   * against re-deliveries (e.g., on `realtime:reconnected` refetch).
   */
  toSampleTimestamp: number
  /**
   * Pre-computed Hermite tangents in degrees PER SEGMENT (not
   * per-second). Computed once at `buildTrack` time so per-frame
   * `predict` can lerp without re-running the trig in
   * `velocityVectorDegPerSec`. null when either velocity is missing
   * or below `MIN_DR_SPEED` — `predict` falls back to ease-out lerp
   * in that case.
   */
  hermiteT0: { dLat: number; dLng: number } | null
  hermiteT1: { dLat: number; dLng: number } | null
}

/**
 * Don't dead-reckon for longer than this past the latest sample. Beyond
 * this, hold at `to` and let the existing 5-min staleness UI take over.
 * 30s is long enough to bridge typical 10-15s gaps comfortably and short
 * enough not to extrapolate a friend off a cliff if they go offline.
 */
export const STALENESS_CAP_SEC = 30

/**
 * Below this speed, treat the sender as stationary. W3C `coords.speed`
 * is jittery in the sub-walking range and dead-reckoning at 0.2 m/s
 * just makes the marker wander.
 */
export const MIN_DR_SPEED = 0.5

const MIN_TWEEN_MS = 200
const MAX_TWEEN_MS = 1000

const EARTH_RADIUS_M = 6_371_000
const toRad = (d: number) => (d * Math.PI) / 180
const toDeg = (r: number) => (r * 180) / Math.PI

/** Cubic ease-out (0..1 → 0..1). Decelerates near the end. */
export function easeOut(u: number): number {
  if (u <= 0) return 0
  if (u >= 1) return 1
  const inv = 1 - u
  return 1 - inv * inv * inv
}

/**
 * Convert a (speed, heading) velocity to a (Δlat, Δlng) per-second
 * vector at the given origin. Lng degrees shrink by cos(lat) toward
 * the poles. Used to feed Hermite tangents.
 */
function velocityVectorDegPerSec(
  origin: LngLat,
  speedMps: number,
  headingDeg: number,
): { dLat: number; dLng: number } {
  const dLatM = speedMps * Math.cos(toRad(headingDeg))
  const dLngM = speedMps * Math.sin(toRad(headingDeg))
  const dLat = toDeg(dLatM / EARTH_RADIUS_M)
  const dLng = toDeg(dLngM / (EARTH_RADIUS_M * Math.cos(toRad(origin.lat))))
  return { dLat, dLng }
}

/**
 * Cubic Hermite interpolation between two endpoints with tangent
 * vectors. P0/P1 are positions in lat/lng; T0/T1 are tangents in
 * lat/lng PER SEGMENT (already scaled by segment duration). u in [0,1].
 *
 * Hermite basis:
 *   h00(u) =  2u³ − 3u² + 1
 *   h10(u) =      u³ − 2u² + u
 *   h01(u) = −2u³ + 3u²
 *   h11(u) =      u³ −  u²
 *
 * Smooth at both endpoints — at u=0 the curve heads in T0's
 * direction, at u=1 it lands heading in T1's direction. That's what
 * makes turns look curved instead of zigzagged.
 */
export function hermiteLatLng(
  p0: LngLat,
  p1: LngLat,
  t0: { dLat: number; dLng: number },
  t1: { dLat: number; dLng: number },
  u: number,
): LngLat {
  const uu = clamp(u, 0, 1)
  const u2 = uu * uu
  const u3 = u2 * uu
  const h00 = 2 * u3 - 3 * u2 + 1
  const h10 = u3 - 2 * u2 + uu
  const h01 = -2 * u3 + 3 * u2
  const h11 = u3 - u2
  return {
    lat: h00 * p0.lat + h10 * t0.dLat + h01 * p1.lat + h11 * t1.dLat,
    lng: h00 * p0.lng + h10 * t0.dLng + h01 * p1.lng + h11 * t1.dLng,
  }
}

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n
}

/**
 * Linear interpolation between two lat/lng points. Equirectangular
 * (treats lat/lng as planar) — accurate enough for the sub-kilometer
 * tweens this is used for. Great-circle math is overkill here.
 */
export function lerpLatLng(a: LngLat, b: LngLat, t: number): LngLat {
  const u = clamp(t, 0, 1)
  return {
    lat: a.lat + (b.lat - a.lat) * u,
    lng: a.lng + (b.lng - a.lng) * u,
  }
}

/**
 * Project a point along a heading by `speed * seconds` meters. Same
 * equirectangular approximation as `distanceMeters` in
 * `useE2eeLocationBroadcast.ts` — symmetric pair: that one measures the
 * gap between two known points, this one walks forward from one.
 *
 * Heading: 0° = north, 90° = east (standard W3C Geolocation convention).
 */
export function projectLatLng(
  origin: LngLat,
  speedMps: number,
  headingDeg: number,
  seconds: number,
): LngLat {
  const distanceM = speedMps * seconds
  const dLatM = distanceM * Math.cos(toRad(headingDeg))
  const dLngM = distanceM * Math.sin(toRad(headingDeg))
  // Convert meters → degrees. The lng-meter scale shrinks by cos(lat)
  // toward the poles; lat-meter scale is constant.
  const latRadians = toRad(origin.lat)
  const dLat = toDeg(dLatM / EARTH_RADIUS_M)
  const dLng = toDeg(dLngM / (EARTH_RADIUS_M * Math.cos(latRadians)))
  return { lat: origin.lat + dLat, lng: origin.lng + dLng }
}

/**
 * Initial bearing (degrees, 0=N, 90=E) from `a` to `b` along the
 * great circle. Used to synthesize a heading when the device's
 * Geolocation API didn't provide one (common on phones at low speed
 * or for a brand-new fix). Returns the standard "compass" heading.
 */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const dLng = toRad(b.lng - a.lng)
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  const deg = (Math.atan2(y, x) * 180) / Math.PI
  return (deg + 360) % 360
}

/**
 * Distance in meters between two lat/lng points. Same equirectangular
 * approximation as the broadcast composable's `distanceMeters`.
 * Duplicated here to keep this module self-contained (no cross-imports
 * between the broadcast composable and the interpolation lib).
 */
export function distanceMeters(a: LngLat, b: LngLat): number {
  const x =
    (toRad(b.lng) - toRad(a.lng)) * Math.cos(toRad((a.lat + b.lat) / 2))
  const y = toRad(b.lat) - toRad(a.lat)
  return Math.sqrt(x * x + y * y) * EARTH_RADIUS_M
}

/**
 * Compute the rendered position for a friend at wall-clock time `now`.
 *
 * Three regimes:
 *   - `now` inside the tween window → Hermite cubic from `from` to
 *     `to` when pre-computed tangents are present (smooth curve
 *     through corners); ease-out linear lerp otherwise.
 *   - `now` past the tween, within staleness cap → dead-reckon forward
 *     from `to` using the sample's velocity.
 *   - `now` past the staleness cap → hold at `to`. The marker's stale
 *     UI (existing) takes over visually.
 */
export function predict(track: Track, now: number): LngLat {
  const elapsedMs = now - track.segmentStartMs

  if (elapsedMs < track.segmentDurationMs) {
    const u = elapsedMs / track.segmentDurationMs

    if (track.hermiteT0 && track.hermiteT1) {
      return hermiteLatLng(
        track.from,
        track.to,
        track.hermiteT0,
        track.hermiteT1,
        u,
      )
    }
    return lerpLatLng(track.from, track.to, easeOut(u))
  }

  const sinceArrivalSec = (elapsedMs - track.segmentDurationMs) / 1000
  if (sinceArrivalSec > STALENESS_CAP_SEC) return track.to

  if (
    track.postSpeed != null &&
    track.postSpeed > MIN_DR_SPEED &&
    track.postHeading != null
  ) {
    return projectLatLng(
      track.to,
      track.postSpeed,
      track.postHeading,
      sinceArrivalSec,
    )
  }

  return track.to
}

/**
 * Build a `Track` for a freshly-arrived sample. `currentRendered` is
 * what the rAF loop is showing on screen RIGHT NOW (output of a prior
 * `predict` call) — passing this in (not the previous sample) is what
 * makes the handoff smooth even when the prediction was off.
 *
 * `previousTrack` (optional) is the track this one is replacing.
 * Its `postSpeed` / `postHeading` become the entry velocity for the
 * Hermite curve — gives the smooth turn through `from` instead of a
 * direction kink. Pass undefined for the very first sample seen.
 */
export function buildTrack(params: {
  currentRendered: LngLat | null
  previousTrack?: Track | null
  sample: {
    lngLat: LngLat
    speed: number | null
    heading: number | null
    timestampMs: number
  }
  now: number
}): Track {
  const { currentRendered, previousTrack, sample, now } = params

  if (!currentRendered) {
    return {
      from: sample.lngLat,
      to: sample.lngLat,
      segmentStartMs: now,
      segmentDurationMs: 0,
      fromVelocity: null,
      postSpeed: sample.speed,
      postHeading: sample.heading,
      toSampleTimestamp: sample.timestampMs,
      hermiteT0: null,
      hermiteT1: null,
    }
  }

  // Real-GPS samples on phones often have null `speed` / `heading` —
  // the W3C Geolocation API only fills them when the device can
  // compute motion confidently. Without them, dead-reckoning past the
  // tween freezes and Hermite falls back to a straight lerp, so the
  // marker visibly stutters between samples.
  //
  // When we have a previous sample and a meaningful elapsed time + jump
  // distance, derive speed/heading from the position delta — same idea
  // the GPX parser uses for points without explicit speed tags. Only
  // synthesize what's missing; respect any device-reported value.
  let resolvedSpeed = sample.speed
  let resolvedHeading = sample.heading
  if (previousTrack && (resolvedSpeed == null || resolvedHeading == null)) {
    const dtSec = (sample.timestampMs - previousTrack.toSampleTimestamp) / 1000
    const distM = distanceMeters(previousTrack.to, sample.lngLat)
    // Guard against zero-time and sub-meter jitter. < 1m doesn't yield
    // a meaningful heading; < ~50ms doesn't yield a meaningful speed.
    if (dtSec >= 0.05 && distM >= 1) {
      if (resolvedSpeed == null) resolvedSpeed = distM / dtSec
      if (resolvedHeading == null) {
        resolvedHeading = bearingDeg(previousTrack.to, sample.lngLat)
      }
    }
  }

  // Tween length scales with the visible jump. ~5 m/ms catch-up rate
  // gives 200ms for a 1m correction and 1s for a 5m+ snap; clamped so
  // tiny corrections don't feel sluggish and big snaps don't drag.
  const jumpM = distanceMeters(currentRendered, sample.lngLat)
  const segmentDurationMs = clamp(jumpM / 5, MIN_TWEEN_MS, MAX_TWEEN_MS)

  const fromVelocity =
    previousTrack &&
    previousTrack.postSpeed != null &&
    previousTrack.postHeading != null
      ? {
          speedMps: previousTrack.postSpeed,
          headingDeg: previousTrack.postHeading,
        }
      : null

  // Pre-compute Hermite tangents in deg PER SEGMENT. Predict() reads
  // these directly each frame — no trig in the hot path. Both must be
  // present and above the dead-reckoning floor for Hermite to win
  // visually; otherwise predict falls back to ease-out linear lerp.
  let hermiteT0: { dLat: number; dLng: number } | null = null
  let hermiteT1: { dLat: number; dLng: number } | null = null
  const haveEntryVel =
    fromVelocity != null && fromVelocity.speedMps > MIN_DR_SPEED
  const haveExitVel =
    resolvedSpeed != null &&
    resolvedSpeed > MIN_DR_SPEED &&
    resolvedHeading != null
  if (haveEntryVel && haveExitVel) {
    const segSec = segmentDurationMs / 1000
    const t0Per = velocityVectorDegPerSec(
      currentRendered,
      fromVelocity!.speedMps,
      fromVelocity!.headingDeg,
    )
    const t1Per = velocityVectorDegPerSec(
      sample.lngLat,
      resolvedSpeed!,
      resolvedHeading!,
    )
    hermiteT0 = { dLat: t0Per.dLat * segSec, dLng: t0Per.dLng * segSec }
    hermiteT1 = { dLat: t1Per.dLat * segSec, dLng: t1Per.dLng * segSec }
  }

  return {
    from: currentRendered,
    to: sample.lngLat,
    segmentStartMs: now,
    segmentDurationMs,
    fromVelocity,
    postSpeed: resolvedSpeed,
    postHeading: resolvedHeading,
    toSampleTimestamp: sample.timestampMs,
    hermiteT0,
    hermiteT1,
  }
}

// ═══════════════════════════════════════════════════════════════════
// Polyline-constrained interpolation — Phase 3 of GTFS-RT
// ═══════════════════════════════════════════════════════════════════

/** A Track constrained to a known polyline (GTFS route shape). */
export interface ConstrainedTrack extends Track {
  /** The polyline this vehicle follows, in order of travel. */
  polyline: LngLat[]
  /** Cumulative distance in meters at each vertex of the polyline. */
  cumulativeDistances: number[]
  /** Total polyline length in meters. */
  totalLength: number
  /** Fractional position [0,1] along the polyline at the `to` sample. */
  toFraction: number
  /** Fractional position [0,1] along the polyline at the `from` (render start). */
  fromFraction: number
}

/** Pre-computed distance table for a polyline. Cache alongside the shape. */
export interface PolylineDistances {
  cumulativeDistances: number[]
  totalLength: number
}

/**
 * Pre-compute cumulative distances for a polyline. Run once per shape
 * and cache — shapes are static GTFS data.
 */
export function buildPolylineDistances(polyline: LngLat[]): PolylineDistances {
  const cumulativeDistances = [0]
  for (let i = 1; i < polyline.length; i++) {
    cumulativeDistances.push(
      cumulativeDistances[i - 1] + distanceMeters(polyline[i - 1], polyline[i]),
    )
  }
  return {
    cumulativeDistances,
    totalLength: cumulativeDistances[cumulativeDistances.length - 1] || 0,
  }
}

/**
 * Snap a geographic position to the nearest point on a polyline.
 * Returns the fractional position [0,1], the snapped lat/lng, and
 * the bearing at that point along the polyline.
 *
 * O(n) over the polyline segments — shapes typically have 100-500
 * vertices, fast enough at 60fps when called once per sample arrival
 * (not per frame).
 */
export function snapToPolyline(
  position: LngLat,
  polyline: LngLat[],
  cumulativeDistances: number[],
  totalLength: number,
): { fraction: number; snapped: LngLat; bearing: number } {
  if (polyline.length < 2 || totalLength === 0) {
    return { fraction: 0, snapped: position, bearing: 0 }
  }

  let bestDist = Infinity
  let bestFraction = 0
  let bestSnapped = polyline[0]
  let bestBearing = 0

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i]
    const b = polyline[i + 1]
    const { point, t } = projectOntoSegment(position, a, b)
    const d = distanceMeters(position, point)
    if (d < bestDist) {
      bestDist = d
      const segDist = cumulativeDistances[i + 1] - cumulativeDistances[i]
      const distAlongPolyline = cumulativeDistances[i] + segDist * t
      bestFraction = distAlongPolyline / totalLength
      bestSnapped = point
      bestBearing = bearingDeg(a, b)
    }
  }

  return {
    fraction: clamp(bestFraction, 0, 1),
    snapped: bestSnapped,
    bearing: bestBearing,
  }
}

/**
 * Project point P onto the line segment A→B. Returns the closest
 * point on the segment and the parametric `t` ∈ [0,1].
 */
function projectOntoSegment(
  p: LngLat,
  a: LngLat,
  b: LngLat,
): { point: LngLat; t: number } {
  const dx = b.lng - a.lng
  const dy = b.lat - a.lat
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return { point: a, t: 0 }
  const t = clamp(
    ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / lenSq,
    0,
    1,
  )
  return {
    point: { lat: a.lat + dy * t, lng: a.lng + dx * t },
    t,
  }
}

/**
 * Interpolate a position along a polyline at a given fraction [0,1].
 * Walks the cumulative distance array to find the segment, then lerps
 * within it.
 */
export function interpolateAlongPolyline(
  fraction: number,
  polyline: LngLat[],
  cumulativeDistances: number[],
  totalLength: number,
): { position: LngLat; bearing: number } {
  if (polyline.length < 2 || totalLength === 0) {
    return { position: polyline[0] || { lat: 0, lng: 0 }, bearing: 0 }
  }

  const f = clamp(fraction, 0, 1)
  const targetDist = f * totalLength

  // Binary search for the segment containing targetDist
  let lo = 0
  let hi = polyline.length - 2
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cumulativeDistances[mid + 1] < targetDist) lo = mid + 1
    else hi = mid
  }

  const segStart = cumulativeDistances[lo]
  const segEnd = cumulativeDistances[lo + 1]
  const segLen = segEnd - segStart
  const t = segLen > 0 ? (targetDist - segStart) / segLen : 0

  return {
    position: lerpLatLng(polyline[lo], polyline[lo + 1], t),
    bearing: bearingDeg(polyline[lo], polyline[lo + 1]),
  }
}

/**
 * Build a constrained track that follows a polyline rather than
 * free-space dead-reckoning.
 */
export function buildConstrainedTrack(params: {
  currentRendered: LngLat | null
  previousTrack?: ConstrainedTrack | null
  sample: {
    lngLat: LngLat
    speed: number | null
    heading: number | null
    timestampMs: number
  }
  polyline: LngLat[]
  polylineDistances: PolylineDistances
  now: number
}): ConstrainedTrack {
  const {
    currentRendered,
    previousTrack,
    sample,
    polyline,
    polylineDistances,
    now,
  } = params
  const { cumulativeDistances, totalLength } = polylineDistances

  // Snap the new sample to the polyline
  const toSnap = snapToPolyline(
    sample.lngLat,
    polyline,
    cumulativeDistances,
    totalLength,
  )

  // Snap the current render position (or use previous track fraction)
  let fromFraction: number
  if (previousTrack) {
    // Continue from where the animation left off
    const predicted = predictConstrained(previousTrack, now)
    const fromSnap = snapToPolyline(
      predicted,
      polyline,
      cumulativeDistances,
      totalLength,
    )
    fromFraction = fromSnap.fraction
  } else if (currentRendered) {
    const fromSnap = snapToPolyline(
      currentRendered,
      polyline,
      cumulativeDistances,
      totalLength,
    )
    fromFraction = fromSnap.fraction
  } else {
    fromFraction = toSnap.fraction
  }

  // Build the base track (reuses tween duration logic)
  const base = buildTrack({
    currentRendered: currentRendered
      ? interpolateAlongPolyline(
          fromFraction,
          polyline,
          cumulativeDistances,
          totalLength,
        ).position
      : null,
    previousTrack: previousTrack ?? null,
    sample: {
      ...sample,
      lngLat: toSnap.snapped,
    },
    now,
  })

  return {
    ...base,
    polyline,
    cumulativeDistances,
    totalLength,
    toFraction: toSnap.fraction,
    fromFraction,
  }
}

/**
 * Predict position for a constrained track. During the tween phase,
 * eases between `fromFraction` and `toFraction` along the polyline.
 * During dead-reckoning, advances forward along the polyline by
 * `speed * elapsed`. Returns the interpolated lat/lng.
 */
export function predictConstrained(
  track: ConstrainedTrack,
  now: number,
): LngLat {
  const elapsedMs = now - track.segmentStartMs

  if (elapsedMs < track.segmentDurationMs) {
    // Tween phase: ease between fractions along the polyline
    const u = easeOut(elapsedMs / track.segmentDurationMs)
    const fraction =
      track.fromFraction + (track.toFraction - track.fromFraction) * u
    return interpolateAlongPolyline(
      fraction,
      track.polyline,
      track.cumulativeDistances,
      track.totalLength,
    ).position
  }

  // Past tween — dead-reckon along the polyline
  const sinceArrivalSec = (elapsedMs - track.segmentDurationMs) / 1000
  if (sinceArrivalSec > STALENESS_CAP_SEC) {
    return interpolateAlongPolyline(
      track.toFraction,
      track.polyline,
      track.cumulativeDistances,
      track.totalLength,
    ).position
  }

  if (
    track.postSpeed != null &&
    track.postSpeed > MIN_DR_SPEED
  ) {
    const distanceTraveled = track.postSpeed * sinceArrivalSec
    const fractionDelta =
      track.totalLength > 0 ? distanceTraveled / track.totalLength : 0
    const fraction = clamp(track.toFraction + fractionDelta, 0, 1)
    return interpolateAlongPolyline(
      fraction,
      track.polyline,
      track.cumulativeDistances,
      track.totalLength,
    ).position
  }

  return interpolateAlongPolyline(
    track.toFraction,
    track.polyline,
    track.cumulativeDistances,
    track.totalLength,
  ).position
}

// ═══════════════════════════════════════════════════════════════════
// Dead-reckoning confidence — accuracy-based speed scaling
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute a dead-reckoning confidence factor (0..1) based on how well
 * past predictions matched actual GPS fixes. Used by the transit
 * vehicles layer to scale DR speed — a vehicle with low confidence
 * won't extrapolate far past its last GPS position.
 *
 * @param prevConfidence  Previous confidence value (0..1)
 * @param prevTargetDist  Distance along route at previous GPS fix
 * @param newTargetDist   Distance along route at new GPS fix
 * @param prevSpeed       Speed that was being used for DR (m/s)
 * @param dt              Time between samples (seconds)
 * @returns Updated confidence value (0..1)
 */
export function updateDrConfidence(
  prevConfidence: number,
  prevTargetDist: number,
  newTargetDist: number,
  prevSpeed: number,
  dt: number,
): number {
  // How far did the vehicle actually travel according to GPS?
  const actualTravel = newTargetDist - prevTargetDist

  // How far did we predict it would travel (raw speed × time)?
  const predictedTravel = prevSpeed * dt

  // Not enough predicted movement to judge accuracy — keep previous
  if (predictedTravel < 2) return prevConfidence

  // Ratio: actual / predicted. 1.0 = perfect prediction.
  // < 1.0 = overshoot (we predicted more than reality)
  // > 1.0 = undershoot (vehicle went further than predicted)
  const ratio = Math.max(0, actualTravel) / predictedTravel

  // Convert ratio to a per-sample confidence score
  let sampleConfidence: number
  if (ratio >= 0.5 && ratio <= 1.3) {
    // Good: actual travel within 50-130% of predicted
    sampleConfidence = 0.8
  } else if (ratio >= 0.2 && ratio <= 2.0) {
    // Moderate: noticeable mismatch but not terrible
    sampleConfidence = 0.4
  } else {
    // Bad: major overshoot or undershoot
    sampleConfidence = 0.1
  }

  // Asymmetric smoothing: lose confidence fast, gain it slowly
  const alpha = sampleConfidence < prevConfidence ? 0.6 : 0.25
  return alpha * sampleConfidence + (1 - alpha) * prevConfidence
}
