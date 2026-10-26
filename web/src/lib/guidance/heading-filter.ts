// Complementary filter: gyro yaw rate for smooth turning between fixes, pulled
// toward a reference bearing (route or GPS course) to cancel drift.

import { angleDelta, normalizeDeg } from './spring'

export class HeadingFilter {
  private heading: number | null = null
  private lastT: number | null = null

  get value(): number | null {
    return this.heading
  }

  /** Integrate yaw rate (deg/s, clockwise positive) up to time `t` seconds. */
  integrate(t: number, yawRate: number | null): void {
    if (this.heading == null || this.lastT == null || yawRate == null) {
      this.lastT = t
      return
    }
    const dt = Math.min(0.2, Math.max(0, t - this.lastT))
    this.heading = normalizeDeg(this.heading + yawRate * dt)
    this.lastT = t
  }

  /**
   * Blend toward `reference` with `gain` in [0, 1]: 1 adopts it outright
   * (first fix, or a reference far more trustworthy than the gyro).
   */
  correct(reference: number, gain: number): void {
    if (this.heading == null) {
      this.heading = normalizeDeg(reference)
      return
    }
    this.heading = normalizeDeg(this.heading + angleDelta(this.heading, reference) * gain)
  }

  reset(): void {
    this.heading = null
    this.lastT = null
  }
}
