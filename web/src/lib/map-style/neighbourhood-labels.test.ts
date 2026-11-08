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

  test('win placement over stations and hand over to the basemap at z14', () => {
    const layers = buildLayers({ flavor: 'light' }) as any[]
    const index = (id: string) => layers.findIndex(l => l.id === id)
    const labels = layers[index(NEIGHBOURHOOD_LAYER)]
    expect(index(NEIGHBOURHOOD_LAYER)).toBe(index('Station') + 1)
    expect(labels).toMatchObject({ source: NEIGHBOURHOOD_SOURCE, maxzoom: 14 })
    expect(labels.paint).toEqual(layers[index('Place labels')].paint)
  })
})
