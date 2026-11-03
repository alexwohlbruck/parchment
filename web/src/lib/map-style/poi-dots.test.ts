import { describe, expect, test } from 'vitest'
import { poiDotLayer } from './poi-dots'

const rankGate = ['step', ['zoom'], ['<=', ['get', 'rank'], 4], 16, true]
const badge = (id: string, cls: string, category: string) => ({
  id,
  type: 'symbol',
  source: 'openmaptiles',
  'source-layer': 'poi',
  filter: ['all', ['==', ['get', 'class'], cls], rankGate],
  layout: { 'icon-image': ['concat', 'poi|', 'badge-', ['get', 'class'], '|', ['match', ['get', 'class'], 'x', '@poi_transit_plate', `@poi_plate_${category}`], '|', '#ink', '|', '#ring', '|', '#lift'] },
  paint: { 'text-color': '#label' },
})

describe('poiDotLayer', () => {
  const layers = [badge('Food', 'cafe', 'food_and_drink'), badge('Shopping', 'shop', 'store')]
  const dots = poiDotLayer(layers)

  test('shows every POI a badge layer could, without its rank gate', () => {
    expect(JSON.stringify(dots.filter)).not.toContain('"step"')
    expect(dots.filter[2]).toEqual([
      'any',
      ['all', ['==', ['get', 'class'], 'cafe']],
      ['all', ['==', ['get', 'class'], 'shop']],
    ])
  })

  test('leaves transit stops to the transit layers', () => {
    expect(dots.filter[1][0]).toBe('!')
    expect(JSON.stringify(dots.filter[1])).toContain('bus_stop')
  })

  test('tints each dot from the category its badge plate is', () => {
    const cafe = ['all', ['==', ['get', 'class'], 'cafe']]
    const shop = ['all', ['==', ['get', 'class'], 'shop']]
    const plate = (kind: string, category: string) =>
      ['match', ['get', 'class'], 'x', '@poi_transit_plate', `@@category-dot-${kind}:${category}`]
    expect(dots.paint['icon-color']).toEqual([
      'case', cafe, plate('fill', 'food_and_drink'), shop, plate('fill', 'store'), plate('fill', 'food_and_drink'),
    ])
    expect(dots.paint['icon-halo-color'][2]).toEqual(plate('edge', 'food_and_drink'))
  })

  test('wears the glyph colours when POIs are drawn without badges', () => {
    const glyph = {
      ...badge('Food', 'cafe', 'food_and_drink'),
      layout: { 'icon-image': ['image', 'cafe'] },
      paint: { 'icon-color': '#f60', 'icon-halo-color': '#fff' },
    }
    const { paint } = poiDotLayer([glyph])
    expect(paint['icon-color'].at(-1)).toBe('#f60')
    expect(paint['icon-halo-color'].at(-1)).toBe('#fff')
  })

  test('is absent when there are no POI layers', () => {
    expect(poiDotLayer([{ id: 'x', type: 'fill', 'source-layer': 'water' }])).toBeNull()
  })
})
