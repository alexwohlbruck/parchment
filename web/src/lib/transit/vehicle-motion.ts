/** How far, and how fast, a live vehicle may coast between GPS fixes. */
import { bearingDeg, distanceMeters } from '@/lib/map/movement-interpolation'
import type { LngLat } from '@/types/map.types'

export interface VehicleFix {
  lngLat: LngLat
  timestampMs: number
}

/** A fix reduced to metres travelled along the vehicle's path. */
export interface PathFix {
  dist: number
  timestampMs: number
}

export type FixCorrection = 'glide' | 'hold' | 'jump'

export const FIX_HISTORY = 3
export const HIGH_CONFIDENCE = 0.8
export const LOW_CONFIDENCE = 0.3
export const MAX_HOLD_M = 200

/** Slowest step over fastest step at which two steps count as the same speed. */
const SPEED_AGREEMENT = 0.6
const MEASURED_ALPHA = 0.3
const UNREPORTED_ALPHA = 0.6
const ARRIVAL_ALPHA = 0.6

export function pushFix(history: VehicleFix[], fix: VehicleFix): VehicleFix[] {
  return [...history, fix].slice(-FIX_HISTORY)
}

/** Free-space fixes measured along the line from the first fix to the last. */
export function alongTrack(fixes: VehicleFix[]): PathFix[] {
  if (fixes.length < 2) return fixes.map((f) => ({ dist: 0, timestampMs: f.timestampMs }))
  const origin = fixes[0].lngLat
  const heading = bearingDeg(origin, fixes[fixes.length - 1].lngLat)
  return fixes.map((f) => ({
    dist: signedProgress(origin, f.lngLat, heading),
    timestampMs: f.timestampMs,
  }))
}

/** Metres from `from` to `to`, projected onto `headingDeg`; negative is behind. */
export function signedProgress(from: LngLat, to: LngLat, headingDeg: number): number {
  const d = distanceMeters(from, to)
  if (d === 0) return 0
  const offset = ((bearingDeg(from, to) - headingDeg) * Math.PI) / 180
  return d * Math.cos(offset)
}

/**
 * Multiplier on dead-reckoning speed. No coasting until a second fix,
 * and full trust only when the last three agree on direction and speed.
 */
export function fixConfidence(fixes: PathFix[]): number {
  const recent = fixes.slice(-FIX_HISTORY)
  if (recent.length < 2) return 0
  const speeds: number[] = []
  for (let i = 1; i < recent.length; i++) {
    const dt = (recent[i].timestampMs - recent[i - 1].timestampMs) / 1000
    if (dt <= 0) return LOW_CONFIDENCE
    speeds.push((recent[i].dist - recent[i - 1].dist) / dt)
  }
  if (speeds.length < FIX_HISTORY - 1) return LOW_CONFIDENCE
  const slowest = Math.min(...speeds)
  if (slowest <= 0) return LOW_CONFIDENCE
  return slowest / Math.max(...speeds) >= SPEED_AGREEMENT
    ? HIGH_CONFIDENCE
    : LOW_CONFIDENCE
}

/** Speed between the last two fixes, or null when they are too close in time. */
export function measuredSpeed(fixes: PathFix[]): number | null {
  if (fixes.length < 2) return null
  const a = fixes[fixes.length - 2]
  const b = fixes[fixes.length - 1]
  const dt = (b.timestampMs - a.timestampMs) / 1000
  if (dt <= 1) return null
  return Math.max(0, (b.dist - a.dist) / dt)
}

/** Speed that reaches the next stop at its predicted arrival, timed from the fix. */
export function arrivalSpeed(
  distToStopM: number,
  fixMs: number,
  arrivalMs: number,
): number | null {
  const seconds = (arrivalMs - fixMs) / 1000
  if (seconds <= 2 || distToStopM <= 0) return null
  return distToStopM / seconds
}

/** Smoothed speed for the next coast: a TripUpdate arrival beats GPS deltas. */
export function nextSpeed(params: {
  previous: number
  arrival: number | null
  measured: number | null
  feedReportsSpeed: boolean
  maxSpeed: number
}): number {
  const { previous, arrival, measured, feedReportsSpeed, maxSpeed } = params
  let speed = previous
  if (arrival != null) {
    speed = ARRIVAL_ALPHA * arrival + (1 - ARRIVAL_ALPHA) * previous
  } else if (measured != null) {
    const alpha = feedReportsSpeed ? MEASURED_ALPHA : UNREPORTED_ALPHA
    speed = alpha * measured + (1 - alpha) * previous
  }
  return Math.min(speed, maxSpeed)
}

/**
 * What to do with a fix `progressM` ahead of the rendered vehicle. A fix
 * behind it is waited out rather than reversed toward; only a fix too far
 * behind to wait for is jumped to.
 */
export function correctionFor(progressM: number): FixCorrection {
  if (progressM >= 0) return 'glide'
  return -progressM <= MAX_HOLD_M ? 'hold' : 'jump'
}
