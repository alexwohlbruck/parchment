export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface MotionSample {
  t: number
  /** accelerationIncludingGravity, device frame, m/s². */
  accelWithGravity: Vec3
  /** rotationRate mapped to device axes, deg/s: x=beta, y=gamma, z=alpha. */
  rotationRate: Vec3
}

const GRAVITY_SMOOTHING = 0.1

// Gravity comes from a low-pass of accelerationIncludingGravity, which points
// up at rest; a clockwise (compass-positive) turn is negative about it.
export class YawRateEstimator {
  private gravity: Vec3 | null = null

  push(sample: MotionSample): number | null {
    const g = sample.accelWithGravity
    if (!this.gravity) {
      this.gravity = { ...g }
    } else {
      this.gravity = {
        x: this.gravity.x + (g.x - this.gravity.x) * GRAVITY_SMOOTHING,
        y: this.gravity.y + (g.y - this.gravity.y) * GRAVITY_SMOOTHING,
        z: this.gravity.z + (g.z - this.gravity.z) * GRAVITY_SMOOTHING,
      }
    }
    const n = Math.hypot(this.gravity.x, this.gravity.y, this.gravity.z)
    if (n < 5) return null
    const w = sample.rotationRate
    const up = (w.x * this.gravity.x + w.y * this.gravity.y + w.z * this.gravity.z) / n
    return -up
  }
}

// A stopped car or a standing pedestrian sits well under 0.15 m/s² of jitter.
export class StillnessDetector {
  private readonly window: { t: number; m: number }[] = []

  constructor(
    private readonly windowSec = 1.5,
    private readonly threshold = 0.15,
  ) {}

  push(sample: MotionSample): void {
    const g = sample.accelWithGravity
    this.window.push({ t: sample.t, m: Math.hypot(g.x, g.y, g.z) })
    while (this.window.length && sample.t - this.window[0].t > this.windowSec) this.window.shift()
  }

  /** null until the window has enough samples to judge. */
  isStill(): boolean | null {
    if (this.window.length < 10) return null
    let mean = 0
    for (const s of this.window) mean += s.m
    mean /= this.window.length
    let variance = 0
    for (const s of this.window) variance += (s.m - mean) ** 2
    return Math.sqrt(variance / this.window.length) < this.threshold
  }
}
