import { describe, expect, it } from 'vitest'
import { Exposure, meterExposure } from './exposure'

const inverse = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

describe('globe exposure metering', () => {
  it('keeps a sunlit hemisphere near baseline and lifts a dark hemisphere', () => {
    expect(meterExposure(inverse, [0, 0, -1])).toBeLessThan(1.1)
    expect(meterExposure(inverse, [0, 0, 1])).toBeGreaterThan(2.9)
    expect(meterExposure(inverse, [0, 0, 1])).toBeLessThanOrEqual(3.2)
    const twilight = meterExposure(inverse, [1, 0, 0])
    expect(twilight).toBeGreaterThan(1.3)
    expect(twilight).toBeLessThan(2)
  })

  it('ignores empty sky and remains neutral if the globe is outside the view', () => {
    const padded = [...inverse]
    padded[12] = 4
    expect(meterExposure(padded, [0, 0, 1])).toBe(1)
  })
})

describe('exposure adaptation', () => {
  it('adapts gradually and settles so idle views stop repainting', () => {
    const exposure = new Exposure()
    expect(exposure.update(3.2, 0)).toBe(1)
    expect(exposure.settled).toBe(false)
    const early = exposure.update(3.2, 100)
    expect(early).toBeGreaterThan(1)
    expect(early).toBeLessThan(2)
    for (let time = 200; time <= 5000; time += 100) exposure.update(3.2, time)
    expect(exposure.value).toBe(3.2)
    expect(exposure.settled).toBe(true)
    expect(exposure.update(1, 5100)).toBeGreaterThan(1)
    expect(exposure.value).toBeLessThan(early + 1.5)
    for (let time = 5200; time <= 7000; time += 100) exposure.update(1, time)
    expect(exposure.value).toBe(1)
    expect(exposure.settled).toBe(true)
  })

  it('uses elapsed time consistently across frame rates', () => {
    const values = [30, 60].map(rate => {
      const exposure = new Exposure()
      for (let frame = 0; frame <= rate; frame++) exposure.update(3.2, frame * 1000 / rate)
      return exposure.value
    })
    expect(values[0]).toBeCloseTo(values[1], 10)
  })
})
