import { describe, expect, test } from 'vitest'
import { poiDotLayer } from './poi-dots'

const rankGate = ['step', ['zoom'], ['<=', ['get', 'rank'], 4], 16, true]
const badge = (id: string, cls: string, color: string) => ({
  id,
  type: 'symbol',
  source: 'openmaptiles',
  'source-layer': 'poi',
  filter: ['all', ['==', ['get', 'class'], cls], rankGate],
  paint: { 'text-color': color, 'text-halo-color': '#fff' },
})

describe('poiDotLayer', () => {
  const layers = [badge('Food', 'cafe', '#f80'), badge('Shopping', 'shop', '#08f')]
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

  test('colours each dot like the label of the layer that would badge it', () => {
    expect(dots.paint['icon-color']).toEqual([
      'case',
      ['all', ['==', ['get', 'class'], 'cafe']], '#f80',
      ['all', ['==', ['get', 'class'], 'shop']], '#08f',
      '#f80',
    ])
  })

  test('is absent when there are no POI layers', () => {
    expect(poiDotLayer([{ id: 'x', type: 'fill', 'source-layer': 'water' }])).toBeNull()
  })
})
