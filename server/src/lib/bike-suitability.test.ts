import { describe, expect, test } from 'bun:test'
import { bikeSuitabilityColor } from './bike-suitability'

describe('bikeSuitabilityColor', () => {
  test('hits the ramp stops exactly', () => {
    expect(bikeSuitabilityColor(0)).toBe('#d11a20')
    expect(bikeSuitabilityColor(100)).toBe('#1f8e48')
  })

  test('runs red through yellow to green', () => {
    const [r0, g0] = [1, 3].map(i => parseInt(bikeSuitabilityColor(10).slice(i, i + 2), 16))
    const [r1, g1] = [1, 3].map(i => parseInt(bikeSuitabilityColor(90).slice(i, i + 2), 16))
    expect(r0).toBeGreaterThan(g0)
    expect(g1).toBeGreaterThan(r1)
  })

  test('clamps out-of-range scores and darkens for a casing', () => {
    expect(bikeSuitabilityColor(-5)).toBe(bikeSuitabilityColor(0))
    expect(bikeSuitabilityColor(50, 0.3)).not.toBe(bikeSuitabilityColor(50))
  })
})
