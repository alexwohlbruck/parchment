// Steps from the bounce in accelerometer magnitude, and the stride that turns
// cadence into walking speed, learned against GPS while it is good.

import type { MotionSample } from './motion'

export const DEFAULT_STRIDE = 0.7
const MIN_STRIDE = 0.35
const MAX_STRIDE = 1.3
const STRIDE_LEARNING = 0.3
const MIN_LEARN_STEPS = 8
const GRAVITY_TIME_CONSTANT = 1
const SIGNAL_TIME_CONSTANT = 0.05
/** Bounce above gravity, m/s², that arms a step; it counts once the signal falls back. */
const STEP_RISE = 1
const STEP_FALL = 0.2
const MIN_STEP_SEC = 0.25
const CADENCE_WINDOW_SEC = 4
const MIN_CADENCE_STEPS = 4
/** No step for this long: the walker has stopped. */
const STEP_TIMEOUT_SEC = 1.5
const MIN_CADENCE = 0.8
const MAX_CADENCE = 3.5
const HISTORY_SEC = 120

export class Pedometer {
  private gravity: number | null = null
  private signal = 0
  private armed = false
  private lastT: number | null = null
  private readonly steps: number[] = []
  private strideMeters = DEFAULT_STRIDE

  get stride(): number {
    return this.strideMeters
  }

  push(sample: MotionSample): void {
    const { x, y, z } = sample.accelWithGravity
    const magnitude = Math.hypot(x, y, z)
    const dt = this.lastT == null ? 0 : Math.min(0.5, Math.max(0, sample.t - this.lastT))
    this.lastT = sample.t
    if (this.gravity == null) {
      this.gravity = magnitude
      return
    }
    this.gravity += (magnitude - this.gravity) * (1 - Math.exp(-dt / GRAVITY_TIME_CONSTANT))
    this.signal += (magnitude - this.gravity - this.signal) * (1 - Math.exp(-dt / SIGNAL_TIME_CONSTANT))
    if (this.signal > STEP_RISE) {
      this.armed = true
    } else if (this.armed && this.signal < STEP_FALL) {
      this.armed = false
      const last = this.steps.at(-1)
      if (last == null || sample.t - last >= MIN_STEP_SEC) this.record(sample.t)
    }
  }

  private record(t: number): void {
    this.steps.push(t)
    while (this.steps.length && t - this.steps[0] > HISTORY_SEC) this.steps.shift()
  }

  /** Steps per second at `t`; null unless the recent steps make a steady walk. */
  cadence(t: number): number | null {
    const last = this.steps.at(-1)
    if (last == null || t - last > STEP_TIMEOUT_SEC) return null
    const recent = this.steps.filter(step => step > t - CADENCE_WINDOW_SEC && step <= t)
    if (recent.length < MIN_CADENCE_STEPS) return null
    const cadence = (recent.length - 1) / (recent.at(-1)! - recent[0])
    return cadence >= MIN_CADENCE && cadence <= MAX_CADENCE ? cadence : null
  }

  /** Walking speed at `t`, m/s; null when no steady walk is sensed. */
  speed(t: number): number | null {
    const cadence = this.cadence(t)
    return cadence == null ? null : cadence * this.strideMeters
  }

  stepsBetween(from: number, to: number): number {
    return this.steps.filter(step => step > from && step <= to).length
  }

  /** Fold in `distance` metres walked, as GPS measured it, over `steps` steps. */
  learnStride(distance: number, steps: number): void {
    if (steps < MIN_LEARN_STEPS) return
    const stride = distance / steps
    if (stride < MIN_STRIDE || stride > MAX_STRIDE) return
    this.strideMeters += (stride - this.strideMeters) * STRIDE_LEARNING
  }
}
