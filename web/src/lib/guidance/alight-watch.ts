// Notices a rider has left the vehicle at the alighting stop, so guidance can
// move on to what comes next without being told.

import type { RideFix } from './ride-estimator'

export interface AlightSignals {
  nowMs: number
  /** Riding, at the alighting stop as GPS sees it or as a dwell or fix confirmed. */
  alighting: boolean
  /** A precise fix off the line beside the alighting stop, at walking pace. */
  offLine: boolean
  /** The pedometer counts a steady walk. */
  walking: boolean
}

/** Off the line beside the stop this long: out of the vehicle. */
export const OFF_LINE_MS = 5_000
/** Walking at the stop this long: off and heading out. */
export const WALKING_MS = 8_000
/** At the stop this long, as a dwell or GPS confirms: the rider is off. */
export const AT_STOP_MS = 90_000

const PRECISE_ACCURACY = 50
const OFF_LINE_METERS = 40
/** How far along the line from the alighting stop a fix still counts as beside it. */
const BESIDE_STOP_METERS = 300
const WALKING_SPEED = 3
const RECENT_MS = 10_000

/** Whether `fix` puts the rider off the line beside the alighting stop at `alightS`. */
export function offLineNear(
  fix: RideFix | null,
  speed: number | null,
  alightS: number,
  nowMs: number,
): boolean {
  if (!fix || nowMs - fix.t > RECENT_MS || fix.accuracy > PRECISE_ACCURACY) return false
  if ((speed ?? 0) > WALKING_SPEED) return false
  return fix.offset > fix.accuracy + OFF_LINE_METERS && Math.abs(alightS - fix.s) <= BESIDE_STOP_METERS
}

export class AlightWatch {
  private since: Partial<Record<'alighting' | 'offLine' | 'walking', number>> = {}

  /** True once the rider is judged off the vehicle. */
  update(signals: AlightSignals): boolean {
    const held = (key: 'alighting' | 'offLine' | 'walking', on: boolean) => {
      if (!on) {
        delete this.since[key]
        return 0
      }
      this.since[key] ??= signals.nowMs
      return signals.nowMs - this.since[key]!
    }
    const offLine = held('offLine', signals.offLine)
    const alighting = held('alighting', signals.alighting)
    const walking = held('walking', signals.alighting && signals.walking)
    return offLine >= OFF_LINE_MS || walking >= WALKING_MS || alighting >= AT_STOP_MS
  }

  reset(): void {
    this.since = {}
  }
}
