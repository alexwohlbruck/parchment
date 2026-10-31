import { describe, expect, it } from 'vitest'
import { navCameraMode, navPowerBudget } from './power-budget'

describe('navPowerBudget', () => {
  it('caps the frame rate harder the deeper the saver', () => {
    const [off, normal, extreme] = (['off', 'normal', 'extreme'] as const).map(s => navPowerBudget(s).minFrameMs)
    expect(off).toBe(0)
    expect(normal).toBeGreaterThan(off)
    expect(extreme).toBeGreaterThan(normal)
  })

  it('forbids 3D only in extreme saver', () => {
    expect(navPowerBudget('normal').allow3d).toBe(true)
    expect(navPowerBudget('extreme').allow3d).toBe(false)
  })
})

describe('navCameraMode', () => {
  it('flattens the 3D follow camera when 3D is forbidden', () => {
    expect(navCameraMode('follow-3d', navPowerBudget('extreme'))).toBe('heading-up')
    expect(navCameraMode('north-up', navPowerBudget('extreme'))).toBe('north-up')
    expect(navCameraMode('follow-3d', navPowerBudget('normal'))).toBe('follow-3d')
  })
})
