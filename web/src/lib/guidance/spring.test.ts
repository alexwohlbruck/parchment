import { describe, expect, test } from 'vitest'
import { angleDelta, createSpring, stepAngleSpring, stepSpring } from './spring'

describe('stepSpring', () => {
  test('settles on the target without overshoot, independent of frame rate', () => {
    const at60 = createSpring(0)
    const at30 = createSpring(0)
    let max = 0
    for (let i = 0; i < 60; i++) max = Math.max(max, stepSpring(at60, 1, 0.3, 1 / 60))
    for (let i = 0; i < 30; i++) stepSpring(at30, 1, 0.3, 1 / 30)
    expect(max).toBeLessThanOrEqual(1)
    expect(at60.value).toBeGreaterThan(0.95)
    expect(at60.value).toBeCloseTo(at30.value, 2)
  })
})

describe('angles', () => {
  test('angleDelta takes the short way round', () => {
    expect(angleDelta(350, 10)).toBe(20)
    expect(angleDelta(10, 350)).toBe(-20)
  })

  test('stepAngleSpring crosses north instead of spinning the long way', () => {
    const spring = createSpring(350)
    const seen: number[] = []
    for (let i = 0; i < 60; i++) seen.push(stepAngleSpring(spring, 10, 0.2, 1 / 60))
    expect(seen.every(v => v >= 340 || v <= 10.001)).toBe(true)
    expect(angleDelta(spring.value, 10)).toBeCloseTo(0, 0)
  })
})
