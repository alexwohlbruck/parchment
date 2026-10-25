// Critically damped springs (SmoothDamp). Frame-rate independent: ~59% of the
// gap closes in `smoothTime`, ~95% in 2.4×.

export interface Spring {
  value: number
  velocity: number
}

export function createSpring(value: number): Spring {
  return { value, velocity: 0 }
}

export function stepSpring(
  spring: Spring,
  target: number,
  smoothTime: number,
  dt: number,
): number {
  if (smoothTime <= 0 || dt <= 0) {
    if (smoothTime <= 0) {
      spring.value = target
      spring.velocity = 0
    }
    return spring.value
  }
  const omega = 2 / smoothTime
  const x = omega * dt
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const change = spring.value - target
  const temp = (spring.velocity + omega * change) * dt
  spring.velocity = (spring.velocity - omega * temp) * decay
  spring.value = target + (change + temp) * decay
  return spring.value
}

/** Signed shortest difference `to − from`, in (−180, 180]. */
export function angleDelta(from: number, to: number): number {
  const d = (((to - from) % 360) + 540) % 360 - 180
  return d === -180 ? 180 : d
}

export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/** Steps an angular spring along the shortest arc; result in [0, 360). */
export function stepAngleSpring(
  spring: Spring,
  target: number,
  smoothTime: number,
  dt: number,
): number {
  const unwrappedTarget = spring.value + angleDelta(spring.value, target)
  stepSpring(spring, unwrappedTarget, smoothTime, dt)
  spring.value = normalizeDeg(spring.value)
  return spring.value
}
