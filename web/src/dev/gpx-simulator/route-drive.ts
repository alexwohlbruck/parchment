// A plausible trip along a route: follows the limit, slows for curves, stops
// at some turns, and accelerates and brakes within the mode's limits.

import type { GpxPoint } from './gpx-parser'
import {
  edgeAt,
  pointAt,
  bearingAt,
  segmentAt,
  type NavRoute,
} from '@/lib/guidance/nav-route'
import { angleDelta } from '@/lib/guidance/spring'
import { createRandom } from './fix-model'

export interface DriveProfile {
  cruise: number
  lateralAccel: number
  accel: number
  decel: number
  /** Chance of stopping at each turn, as at a light or stop sign. */
  stopChance: number
  maxStopSec: number
  /** Grid spacing, metres. */
  step: number
}

export const DRIVE_PROFILES: Record<string, DriveProfile> = {
  driving: { cruise: 13.4, lateralAccel: 2.5, accel: 2, decel: 2.5, stopChance: 0.5, maxStopSec: 25, step: 2 },
  cycling: { cruise: 5.5, lateralAccel: 1.5, accel: 0.8, decel: 1.5, stopChance: 0.3, maxStopSec: 15, step: 1 },
  walking: { cruise: 1.4, lateralAccel: 10, accel: 0.5, decel: 1, stopChance: 0.2, maxStopSec: 20, step: 1 },
}

const TURN_MODIFIERS = new Set(['left', 'right', 'u-turn'])
/** Getting in or out of a vehicle, docking a bike. */
const MODE_CHANGE_SEC = 20
const CURVE_PROBE = 10
const MIN_ROLLING_SPEED = 0.3

export function profileFor(mode: string): DriveProfile {
  return DRIVE_PROFILES[mode] ?? DRIVE_PROFILES.driving
}

function speedLimitAt(route: NavRoute, s: number, profile: DriveProfile, mode: string): number {
  if (mode !== 'driving') return profile.cruise
  const edge = edgeAt(route, s)
  const kmh = edge?.speedLimit ?? edge?.averageSpeed
  return kmh ? (kmh / 3.6) * 0.95 : profile.cruise
}

function curveSpeedAt(route: NavRoute, s: number, profile: DriveProfile): number {
  const before = bearingAt(route, Math.max(0, s - CURVE_PROBE))
  const after = bearingAt(route, Math.min(route.length, s + CURVE_PROBE))
  const turn = Math.abs(angleDelta(before, after)) * (Math.PI / 180)
  if (turn < 0.05) return Infinity
  const radius = (2 * CURVE_PROBE) / turn
  return Math.sqrt(profile.lateralAccel * radius)
}

/** Each segment drives with its own mode's profile; legs default to `fallbackMode`. */
export function synthesizeDrive(
  route: NavRoute,
  fallbackMode: string,
  startTimeMs: number,
  seed = 1,
): GpxPoint[] {
  const random = createRandom(seed)
  const finest = Math.min(...route.segments.map(seg => profileFor(seg.mode).step), profileFor(fallbackMode).step)
  const n = Math.max(2, Math.ceil(route.length / finest) + 1)
  const ds = route.length / (n - 1)
  const limit = new Float64Array(n)
  const dwell = new Float64Array(n)
  const profiles: DriveProfile[] = new Array(n)

  for (let i = 0; i < n; i++) {
    const s = i * ds
    const mode = segmentAt(route, s)?.mode ?? fallbackMode
    const profile = profileFor(mode)
    profiles[i] = profile
    limit[i] = Math.min(speedLimitAt(route, s, profile, mode), curveSpeedAt(route, s, profile))
  }
  for (const step of route.steps) {
    const modifier = step.instruction.modifier
    if (!modifier || !TURN_MODIFIERS.has(modifier) || step.startDistance <= 0) continue
    const i = Math.min(n - 1, Math.round(step.startDistance / ds))
    if (random() >= profiles[i].stopChance) continue
    limit[i] = 0
    dwell[i] = 3 + random() * (profiles[i].maxStopSec - 3)
  }
  for (const segment of route.segments.slice(1)) {
    const i = Math.min(n - 1, Math.round(segment.startDistance / ds))
    limit[i] = 0
    dwell[i] = MODE_CHANGE_SEC
  }
  limit[0] = 0
  limit[n - 1] = 0

  const v = Float64Array.from(limit)
  for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * profiles[i].accel * ds))
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * profiles[i].decel * ds))

  const points: GpxPoint[] = []
  let t = startTimeMs
  const push = (i: number, speed: number) => {
    const s = i * ds
    const p = pointAt(route, s)
    points.push({
      lat: p.lat,
      lng: p.lng,
      time: t,
      altitude: null,
      speed,
      heading: speed > 0.5 ? bearingAt(route, s) : null,
    })
  }

  push(0, 0)
  for (let i = 1; i < n; i++) {
    const avg = Math.max(MIN_ROLLING_SPEED, (v[i - 1] + v[i]) / 2)
    t += (ds / avg) * 1000
    push(i, v[i])
    if (dwell[i] > 0) {
      t += dwell[i] * 1000
      push(i, 0)
    }
  }
  return points
}
