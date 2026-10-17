import { describe, expect, it } from 'vitest'
import { expression } from '@maplibre/maplibre-gl-style-spec'
import { buildingFacadeColor } from './building-facade'
import { FACADE_STYLE, FACADE_UNKNOWN } from '@/lib/map/facade-shader'

const evaluate = (properties: Record<string, unknown>) => {
  const e = expression.createExpression(buildingFacadeColor(), {
    type: 'color', 'property-type': 'data-driven', expression: { interpolated: false, parameters: ['zoom', 'feature'] },
  } as any)
  if (e.result !== 'success') throw new Error(JSON.stringify(e.value))
  return Math.round((e.value.evaluate({ zoom: 16 }, { properties, type: 'Polygon' } as any) as any).r * 255 / 16)
}

describe('buildingFacadeColor', () => {
  it('carries the style id for a known kind, whatever its case', () => {
    expect(evaluate({ kind: 'office' })).toBe(FACADE_STYLE.curtain)
    expect(evaluate({ kind: 'Apartments' })).toBe(FACADE_STYLE.punched)
    expect(evaluate({ kind: 'parking' })).toBe(FACADE_STYLE.parking)
    expect(evaluate({ kind: 'church' })).toBe(FACADE_STYLE.plain)
  })

  it('leaves an unknown or missing kind for the shader to guess', () => {
    expect(evaluate({ kind: 'yes_but_odd' })).toBe(FACADE_UNKNOWN)
    expect(evaluate({})).toBe(FACADE_UNKNOWN)
  })

  it('fits every id in one packed colour channel', () => {
    expect(Math.max(FACADE_UNKNOWN, ...Object.values(FACADE_STYLE)) * 16).toBeLessThanOrEqual(255)
  })
})
