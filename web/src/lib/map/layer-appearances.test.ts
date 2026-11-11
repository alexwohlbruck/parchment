import { describe, expect, test } from 'vitest'
import { appearanceGroupVisibility, CYCLING_GROUP_ID, resolveAppearance } from './layer-appearances'

describe('layer appearances', () => {
  test('falls back to the first appearance for an unknown or missing choice', () => {
    expect(resolveAppearance(CYCLING_GROUP_ID, undefined)?.id).toBe('infrastructure')
    expect(resolveAppearance(CYCLING_GROUP_ID, 'gone')?.id).toBe('infrastructure')
    expect(resolveAppearance(CYCLING_GROUP_ID, 'suitability')?.id).toBe('suitability')
    expect(resolveAppearance('default:group:terrain', undefined)).toBeUndefined()
  })

  test('shows only the chosen appearance, and nothing while the layer is off', () => {
    const suitability = resolveAppearance(CYCLING_GROUP_ID, 'suitability')!
    const on = appearanceGroupVisibility(CYCLING_GROUP_ID, true, suitability)
    expect(on.get('default:group:bike-suitability')).toBe(true)
    expect(on.get(`${CYCLING_GROUP_ID}:cycleways`)).toBe(false)
    const off = appearanceGroupVisibility(CYCLING_GROUP_ID, false, suitability)
    expect([...off.values()].every(v => !v)).toBe(true)
  })
})
