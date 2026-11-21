import { describe, test, expect } from 'vitest'
import { featureFilter, expression, latest } from '@maplibre/maplibre-gl-style-spec'
import { buildLayers } from './build'
import {
  ABORIGINAL_LAND_FILL_LAYER, ABORIGINAL_LAND_LABEL_LAYER, ABORIGINAL_LAND_OUTLINE_LAYER,
  LABEL_TEXT, labelFilter,
} from './aboriginal-lands'

const KM2 = 1e6
const labelled = (zoom: number, km2: number) =>
  featureFilter(labelFilter(), 'filter').filter({ zoom }, { type: 1, properties: { area: km2 * KM2 } } as any)

const text = (properties: Record<string, string>) => {
  const parsed = expression.createExpression(LABEL_TEXT, latest.layout_symbol['text-field'] as any) as any
  const value = parsed.value.evaluate({ zoom: 8 }, { type: 1, properties })
  return value.sections ? value.sections.map((s: any) => s.text).join('') : String(value)
}

describe('Indigenous lands', () => {
  test('name larger parcels first', () => {
    expect([5, 6, 8, 10, 12].map(z => labelled(z, 5000))).toEqual([true, true, true, true, true])
    expect([5, 6, 8].map(z => labelled(z, 500))).toEqual([false, true, true])
    expect([7, 8].map(z => labelled(z, 50))).toEqual([false, true])
    expect([11, 12].map(z => labelled(z, 0.5))).toEqual([false, true])
  })

  test('set the Indigenous-language name over the English one', () => {
    expect(text({ name: 'Bathurst Inlet Inuit-owned lands', name_local: 'ᑭᙵᐅᒃ' })).toBe('ᑭᙵᐅᒃ\nBathurst Inlet Inuit-owned lands')
    expect(text({ name: 'Navajo Nation' })).toBe('Navajo Nation')
    expect(text({ name_local: 'ᑭᙵᐅᒃ' })).toBe('ᑭᙵᐅᒃ')
  })

  test('sit under the water and the place labels', () => {
    const layers = buildLayers({ flavor: 'light' }) as any[]
    const index = (id: string) => layers.findIndex(l => l.id === id)
    expect(index(ABORIGINAL_LAND_FILL_LAYER)).toBeGreaterThan(index('Sand'))
    expect(index(ABORIGINAL_LAND_OUTLINE_LAYER)).toBeLessThan(index('Water'))
    expect(index(ABORIGINAL_LAND_LABEL_LAYER)).toBe(index('Place labels') - 1)
  })
})
