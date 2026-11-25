import { describe, expect, test } from 'vitest'
import { featureFilter } from '@maplibre/maplibre-gl-style-spec'
import { buildLayers } from './build'
import { BUILDING_LABELS_LAYER } from './building-labels'

const layers = buildLayers({ flavor: 'dark' }) as any[]
const poiLayers = layers.filter(l => l.type === 'symbol' && l['source-layer'] === 'poi')

function draws(layer: any, properties: Record<string, unknown>): boolean {
  const filter = featureFilter(layer.filter, `${layer.id}.filter`)
  return filter.filter({ zoom: 18 } as any, { type: 1, properties } as any, {} as any)
}

describe('building labels', () => {
  const named = { class: 'building', subclass: 'school', name: 'Math Building', rank: 1 }

  test('only the building label layer draws a named building', () => {
    expect(poiLayers.filter(l => draws(l, named)).map(l => l.id)).toEqual([BUILDING_LABELS_LAYER])
  })

  test('sits under every other POI layer, so places win a collision', () => {
    expect(poiLayers.filter(l => l.id !== 'POI dots')[0].id).toBe(BUILDING_LABELS_LAYER)
  })

  test('leaves other places to their own layers', () => {
    const labels = layers.find(l => l.id === BUILDING_LABELS_LAYER)
    expect(draws(labels, { class: 'theatre', subclass: 'theatre', name: 'A Building' })).toBe(false)
  })
})
