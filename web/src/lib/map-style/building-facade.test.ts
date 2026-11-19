import { describe, expect, it } from 'vitest'
import { expression } from '@maplibre/maplibre-gl-style-spec'
import { buildingFacadeSeed, buildingFacadeStyle } from './building-facade'
import { FACADE_STYLE, FACADE_UNKNOWN } from '@/lib/map/facade-shader'

const evaluate = (source: unknown, properties: Record<string, unknown>, id?: number) => {
  const e = expression.createExpression(source, {
    type: 'number', 'property-type': 'data-driven', expression: { interpolated: false, parameters: ['zoom', 'feature'] },
  } as any)
  if (e.result !== 'success') throw new Error(JSON.stringify(e.value))
  return e.value.evaluate({ zoom: 16 }, { properties, id, type: 'Polygon' } as any) as number
}

describe('buildingFacadeStyle', () => {
  const style = (properties: Record<string, unknown>) => evaluate(buildingFacadeStyle(), properties)

  it('gives the style id for a known kind, whatever its case', () => {
    expect(style({ kind: 'office' })).toBe(FACADE_STYLE.curtain)
    expect(style({ kind: 'Apartments' })).toBe(FACADE_STYLE.punched)
    expect(style({ kind: 'parking' })).toBe(FACADE_STYLE.parking)
    expect(style({ kind: 'church' })).toBe(FACADE_STYLE.plain)
  })

  it('leaves an unknown or missing kind for the shader to guess', () => {
    expect(style({ kind: 'yes_but_odd' })).toBe(FACADE_UNKNOWN)
    expect(style({})).toBe(FACADE_UNKNOWN)
  })
})

describe('buildingFacadeSeed', () => {
  const seed = (properties: Record<string, unknown>, id: number) => evaluate(buildingFacadeSeed(), properties, id)

  it('seeds a building by its id, every part by the building it belongs to', () => {
    expect(seed({}, 1234561)).toBe(seed({}, 1234561))
    expect(seed({}, 1234561)).not.toBe(seed({}, 1234571))
    expect(seed({ group_id: 1234561 }, 99)).toBe(seed({}, 1234561))
  })

  it('stays within what the shader hashes exactly', () => {
    expect(seed({}, 2 ** 40 + 77)).toBeLessThan(65536)
  })
})
