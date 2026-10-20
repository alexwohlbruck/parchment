export function meterExposure(inverse: ArrayLike<number>, sun: readonly number[]): number {
  const point = (x: number, y: number, z: number) => {
    const w = inverse[3] * x + inverse[7] * y + inverse[11] * z + inverse[15]
    return [
      (inverse[0] * x + inverse[4] * y + inverse[8] * z + inverse[12]) / w,
      (inverse[1] * x + inverse[5] * y + inverse[9] * z + inverse[13]) / w,
      (inverse[2] * x + inverse[6] * y + inverse[10] * z + inverse[14]) / w,
    ]
  }
  let daylight = 0
  let count = 0
  for (let y = -5; y <= 5; y++) {
    for (let x = -5; x <= 5; x++) {
      const near = point(x / 5, y / 5, -1)
      const far = point(x / 5, y / 5, 0)
      const ray = far.map((value, i) => value - near[i])
      const length = Math.hypot(...ray)
      if (!length) continue
      for (let i = 0; i < 3; i++) ray[i] /= length
      const along = -near.reduce((sum, value, i) => sum + value * ray[i], 0)
      const distanceSquared = near.reduce((sum, value, i) => sum + (value + ray[i] * along) ** 2, 0)
      if (along < 0 || distanceSquared > 1) continue
      const hit = along - Math.sqrt(1 - distanceSquared)
      const illumination = near.reduce((sum, value, i) => sum + (value + ray[i] * hit) * sun[i], 0)
      const t = Math.max(0, Math.min(1, (illumination + 0.2) / 0.55))
      daylight += t * t * (3 - 2 * t)
      count++
    }
  }
  const darkness = count ? 1 - daylight / count : 0
  return 1 + 2.2 * darkness * darkness
}

export class Exposure {
  value = 1
  settled = true
  private lastTime?: number

  update(target: number, now: number) {
    const elapsed = this.lastTime === undefined ? 0 : Math.max(0, Math.min(100, now - this.lastTime))
    this.lastTime = now
    const duration = target > this.value ? 650 : 250
    this.value += (target - this.value) * (1 - Math.exp(-elapsed / duration))
    this.settled = Math.abs(target - this.value) < 0.01
    if (this.settled) this.value = target
    return this.value
  }
}
