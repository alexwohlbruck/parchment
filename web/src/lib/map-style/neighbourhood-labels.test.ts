import { describe, test, expect } from 'vitest'
import { featureFilter } from '@maplibre/maplibre-gl-style-spec'
import { buildLayers } from './build'
import { NEIGHBOURHOOD_LAYER, NEIGHBOURHOOD_SOURCE, tierFilter } from './neighbourhood-labels'

const shown = (zoom: number, tier: number) =>
  featureFilter(tierFilter(), 'layers[0].filter').filter({ zoom }, { type: 1, properties: { tier } } as any)

describe('neighbourhood labels', () => {
  test('each tier enters at its own zoom', () => {
    expect([10, 11, 12, 13].map(z => shown(z, 0))).toEqual([false, true, true, true])
    expect([11, 11.9, 12, 13].map(z => shown(z, 1))).toEqual([false, false, true, true])
    expect([12, 12.9, 13].map(z => shown(z, 2))).toEqual([false, false, true])
  })

  test('sit just under the basemap place labels and hand over to them at z14', () => {
    const layers = buildLayers({ flavor: 'light' }) as any[]
    const at = layers.findIndex(l => l.id === NEIGHBOURHOOD_LAYER)
    expect(layers[at + 1].id).toBe('Place labels')
    expect(layers[at]).toMatchObject({ source: NEIGHBOURHOOD_SOURCE, maxzoom: 14 })
    expect(layers[at].paint).toEqual(layers[at + 1].paint)
  })
})
