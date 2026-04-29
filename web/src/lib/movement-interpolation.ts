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
 *     `to` when both endpoint velocities are known (smooth curve
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
    const segSec = track.segmentDurationMs / 1000

    const haveEntryVel =
      track.fromVelocity &&
      track.fromVelocity.speedMps > MIN_DR_SPEED
    const haveExitVel =
      track.postSpeed != null &&
      track.postSpeed > MIN_DR_SPEED &&
      track.postHeading != null

    // Hermite needs both tangents. When either is missing, fall back
    // to ease-out linear lerp — better than picking an arbitrary zero
    // tangent which would yield a worse-looking S-curve.
    if (haveEntryVel && haveExitVel) {
      const t0Per = velocityVectorDegPerSec(
        track.from,
        track.fromVelocity!.speedMps,
        track.fromVelocity!.headingDeg,
      )
      const t1Per = velocityVectorDegPerSec(
        track.to,
        track.postSpeed!,
        track.postHeading!,
      )
      // Hermite tangents are per-segment, not per-second.
      const t0 = { dLat: t0Per.dLat * segSec, dLng: t0Per.dLng * segSec }
      const t1 = { dLat: t1Per.dLat * segSec, dLng: t1Per.dLng * segSec }
      return hermiteLatLng(track.from, track.to, t0, t1, u)
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

  return {
    from: currentRendered,
    to: sample.lngLat,
    segmentStartMs: now,
    segmentDurationMs,
    fromVelocity,
    postSpeed: sample.speed,
    postHeading: sample.heading,
    toSampleTimestamp: sample.timestampMs,
  }
}
