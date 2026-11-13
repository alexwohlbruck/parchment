// Which way the traveller faces: the route's direction while they move, the
// phone's compass while they dawdle on foot or bike.

import { compassReliable } from '@/lib/directions/start-motion'
import { angleDelta, createSpring, normalizeDeg, stepAngleSpring, stepSpring } from './spring'

/** Modes where the phone is in hand or on the bars, so it points the way the traveller does. */
const COMPASS_MODES = new Set(['walking', 'cycling'])
/** At or below this the compass alone sets the facing; at `COURSE_SPEED` the route does. */
const COMPASS_SPEED = 0.5
const COURSE_SPEED = 1.2
/** Tilt of a phone being looked at; beyond it the phone is likely upright in a pocket or face down. */
const MIN_TILT = -15
const MAX_TILT = 75
const COMPASS_SMOOTH_SEC = 0.25
const WEIGHT_SMOOTH_SEC = 0.4
/** Compass wobble the camera ignores, degrees. */
export const CAMERA_DEAD_BAND = 10

export interface CompassReading {
  heading: number | null
  /** Degrees of uncertainty; negative when uncalibrated, null when the platform gives none. */
  accuracy: number | null
  /** Front-back tilt towards the viewer, degrees: 0 flat, 90 upright. */
  tilt: number | null
}

export interface Facing {
  /** Null when neither the route nor the compass says. */
  bearing: number | null
  compass: number | null
  /** 0 the route sets the facing … 1 the compass does. */
  weight: number
}

export interface FacingInput {
  /** Null when the puck's course is unknown. */
  routeBearing: number | null
  speed: number
  mode: string
  compass: CompassReading
}

function finite(value: number | null): value is number {
  return value != null && Number.isFinite(value)
}

export function compassUsable({ heading, accuracy, tilt }: CompassReading): boolean {
  if (!finite(heading)) return false
  if (!compassReliable(accuracy)) return false
  return tilt == null || (tilt >= MIN_TILT && tilt <= MAX_TILT)
}

export function compassWeight({ speed, mode, compass }: Omit<FacingInput, 'routeBearing'>): number {
  if (!COMPASS_MODES.has(mode) || !compassUsable(compass)) return 0
  const t = (speed - COMPASS_SPEED) / (COURSE_SPEED - COMPASS_SPEED)
  return 1 - Math.min(1, Math.max(0, t))
}

export function blendAngle(from: number, to: number, weight: number): number {
  return normalizeDeg(from + angleDelta(from, to) * weight)
}

/** Keeps `held` until `target` strays more than `band` from it. */
export function holdBearing(held: number | null, target: number, band = CAMERA_DEAD_BAND): number {
  return held == null || Math.abs(angleDelta(held, target)) > band ? target : held
}

export class FacingFilter {
  private compass = createSpring(0)
  private hasCompass = false
  private weight = createSpring(0)
  private lastT: number | null = null

  update(input: FacingInput, t: number): Facing {
    const dt = this.lastT == null ? 0 : Math.min(0.2, Math.max(0, t - this.lastT))
    this.lastT = t

    const target = compassWeight(input)
    const heading = input.compass.heading
    if (target > 0 && finite(heading)) {
      if (this.hasCompass) stepAngleSpring(this.compass, heading, COMPASS_SMOOTH_SEC, dt)
      else this.compass = createSpring(normalizeDeg(heading))
      this.hasCompass = true
    }
    const weight = this.hasCompass ? Math.min(1, Math.max(0, stepSpring(this.weight, target, WEIGHT_SMOOTH_SEC, dt))) : 0
    const compass = this.hasCompass ? this.compass.value : null

    let bearing: number | null = input.routeBearing
    if (compass != null && weight > 0) bearing = bearing == null ? compass : blendAngle(bearing, compass, weight)
    return { bearing, compass, weight }
  }

  reset(): void {
    this.hasCompass = false
    this.weight = createSpring(0)
    this.lastT = null
  }
}
