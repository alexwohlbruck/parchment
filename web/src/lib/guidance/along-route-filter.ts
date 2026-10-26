// Kalman filter over [s, v, a] along the route (constant-acceleration model).
// Predicting between fixes is what keeps the puck from trailing a fix behind.

export interface FilterState {
  s: number
  v: number
  a: number
}

export interface FilterOptions {
  /** Jerk noise, m/s³. Higher follows sharp speed changes, lower smooths. */
  jerkSigma: number
  maxAccel: number
  maxDecel: number
  /** Innovations beyond this many σ are rejected as outliers. */
  gateSigmas: number
  /** Consecutive rejections after which the filter re-seeds on the fix. */
  maxRejections: number
}

export const DEFAULT_FILTER_OPTIONS: FilterOptions = {
  jerkSigma: 1.5,
  maxAccel: 4,
  maxDecel: 8,
  gateSigmas: 3.5,
  maxRejections: 3,
}

type Mat3 = [number, number, number, number, number, number, number, number, number]

export class AlongRouteFilter {
  private x: FilterState
  private P: Mat3
  private t: number
  private rejections = 0
  private options: FilterOptions

  constructor(initial: { s: number; v?: number; t: number; sigma?: number }, options?: Partial<FilterOptions>) {
    this.options = { ...DEFAULT_FILTER_OPTIONS, ...options }
    this.x = { s: initial.s, v: initial.v ?? 0, a: 0 }
    this.t = initial.t
    const sv = initial.sigma ?? 10
    this.P = [sv * sv, 0, 0, 0, 25, 0, 0, 0, 4]
  }

  /** Retune for a new way of travelling (walking is gentler than driving). */
  setJerkSigma(jerkSigma: number): void {
    this.options = { ...this.options, jerkSigma }
  }

  get time(): number {
    return this.t
  }

  get state(): Readonly<FilterState> {
    return this.x
  }

  get positionSigma(): number {
    return Math.sqrt(this.P[0])
  }

  /** Extrapolated state at `t` without mutating the filter. */
  predict(t: number, maxHorizon = 30): FilterState {
    let dt = Math.min(Math.max(0, t - this.t), maxHorizon)
    const { s, v, a } = this.x
    // Acceleration decays toward zero over the horizon (time constant 2 s);
    // an unchecked ½at² overshoots badly once fixes stop arriving.
    if (a < 0) {
      const stopFactor = 1 + v / (2 * a)
      if (stopFactor > 0) dt = Math.min(dt, -2 * Math.log(stopFactor))
    }
    const decay = Math.exp(-dt / 2)
    const vNext = Math.max(0, v + a * 2 * (1 - decay))
    const travelled = v * dt + a * 2 * (dt - 2 * (1 - decay))
    return { s: s + Math.max(0, travelled), v: vNext, a: vNext > 0 ? a * decay : 0 }
  }

  /** Advance the covariance and state to time `t`. */
  private propagate(t: number): void {
    const dt = t - this.t
    if (dt <= 0) return
    const { s, v, a } = this.x
    this.x = {
      s: s + v * dt + 0.5 * a * dt * dt,
      v: v + a * dt,
      a,
    }
    const F: Mat3 = [1, dt, 0.5 * dt * dt, 0, 1, dt, 0, 0, 1]
    const q = this.options.jerkSigma ** 2
    const dt2 = dt * dt
    const dt3 = dt2 * dt
    const dt4 = dt3 * dt
    const dt5 = dt4 * dt
    const Q: Mat3 = [
      (q * dt5) / 20, (q * dt4) / 8, (q * dt3) / 6,
      (q * dt4) / 8, (q * dt3) / 3, (q * dt2) / 2,
      (q * dt3) / 6, (q * dt2) / 2, q * dt,
    ]
    this.P = add(mul(mul(F, this.P), transpose(F)), Q)
    this.t = t
    this.clamp()
  }

  /**
   * Fold in a measurement of one state component (0 = s, 1 = v). Returns
   * false when the measurement was gated out as an outlier.
   */
  private measure(component: 0 | 1, z: number, variance: number): boolean {
    const P = this.P
    const value = component === 0 ? this.x.s : this.x.v
    const innovation = z - value
    const S = P[component * 4] + variance
    if (innovation * innovation > this.options.gateSigmas ** 2 * S) return false
    const K = [P[component] / S, P[3 + component] / S, P[6 + component] / S]
    this.x = {
      s: this.x.s + K[0] * innovation,
      v: this.x.v + K[1] * innovation,
      a: this.x.a + K[2] * innovation,
    }
    const row: [number, number, number] = [P[component * 3], P[component * 3 + 1], P[component * 3 + 2]]
    const next = [...P] as Mat3
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) next[i * 3 + j] -= K[i] * row[j]
    }
    this.P = next
    this.clamp()
    return true
  }

  /**
   * Update with a fix snapped to route distance `s` (σ `sigma`) at time `t`,
   * and its reported speed when the platform gave one.
   */
  update(fix: { t: number; s: number; sigma: number; speed?: number | null }): { accepted: boolean } {
    this.propagate(fix.t)
    const accepted = this.measure(0, fix.s, fix.sigma * fix.sigma)
    if (fix.speed != null && Number.isFinite(fix.speed)) {
      this.measure(1, Math.max(0, fix.speed), 0.5 ** 2)
    }
    if (accepted) {
      this.rejections = 0
    } else if (++this.rejections >= this.options.maxRejections) {
      this.reset({ s: fix.s, v: fix.speed ?? this.x.v, t: fix.t, sigma: fix.sigma })
      return { accepted: true }
    }
    return { accepted }
  }

  /** Hold position: the vehicle is stationary (red light, stop sign). */
  hold(t: number): void {
    this.propagate(t)
    this.x = { s: this.x.s, v: 0, a: 0 }
    this.P = [this.P[0], 0, 0, 0, 0.05, 0, 0, 0, 0.05]
  }

  reset(initial: { s: number; v?: number; t: number; sigma?: number }): void {
    const sv = initial.sigma ?? 10
    this.x = { s: initial.s, v: Math.max(0, initial.v ?? 0), a: 0 }
    this.t = initial.t
    this.P = [sv * sv, 0, 0, 0, 25, 0, 0, 0, 4]
    this.rejections = 0
  }

  private clamp(): void {
    const { maxAccel, maxDecel } = this.options
    this.x.v = Math.max(0, this.x.v)
    this.x.a = Math.min(maxAccel, Math.max(-maxDecel, this.x.a))
  }
}

function mul(A: Mat3, B: Mat3): Mat3 {
  const out = new Array(9).fill(0) as Mat3
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]
    }
  }
  return out
}

function transpose(A: Mat3): Mat3 {
  return [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]]
}

function add(A: Mat3, B: Mat3): Mat3 {
  return A.map((v, i) => v + B[i]) as Mat3
}
