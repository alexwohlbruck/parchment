import { describe, expect, test } from 'vitest'
import { basemapPoiLook, isBasemapPoiLayer, RAISED_POI_SOURCE } from './basemap-poi-look'

const SIZE = ['interpolate', ['linear'], ['zoom'], 15, 11, 18, 13]

describe('basemap POI layers', () => {
  test('are POI symbols on the tiles or lifted onto the raised source', () => {
    expect(isBasemapPoiLayer({ id: 'Food', type: 'symbol', 'source-layer': 'poi' })).toBe(true)
    expect(isBasemapPoiLayer({ id: 'Food', type: 'symbol', source: RAISED_POI_SOURCE })).toBe(true)
    expect(isBasemapPoiLayer({ id: 'Road labels', type: 'symbol', 'source-layer': 'transportation_name' })).toBe(false)
    expect(isBasemapPoiLayer({ id: 'keeper', type: 'circle', 'source-layer': 'poi' })).toBe(false)
  })
})

describe('basemapPoiLook', () => {
  const layers = [
    { id: 'Building 3D', type: 'fill-extrusion', 'source-layer': 'building' },
    { id: 'POI dots', type: 'symbol', source: RAISED_POI_SOURCE, layout: { 'icon-size': 0.5 } },
    {
      id: 'Food',
      type: 'symbol',
      source: RAISED_POI_SOURCE,
      layout: {
        'icon-image': ['get', 'badge'],
        'icon-size': 1,
        'text-field': ['get', 'name'],
        'text-font': ['Inter SemiBold'],
        'text-size': SIZE,
        'text-offset': [0, 0.9],
        'text-anchor': 'top',
        'symbol-height-offset': ['get', '_elev'],
      },
      paint: { 'text-color': ['get', 'ink'], 'text-halo-color': '#fff', 'text-halo-width': 1.5, 'icon-opacity': 1 },
    },
  ]

  test('copies everything but the per-feature properties of the first labelled POI layer', () => {
    expect(basemapPoiLook(layers)).toEqual({
      layout: {
        'icon-size': 1,
        'text-font': ['Inter SemiBold'],
        'text-size': SIZE,
        'text-offset': [0, 0.9],
        'text-anchor': 'top',
        'symbol-height-offset': ['get', '_elev'],
      },
      paint: { 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
      badges: false,
    })
  })

  test('knows when the style composites badges', () => {
    const food = { ...layers[2], layout: { ...layers[2].layout, 'icon-image': ['concat', 'poi|', ['get', 'class']] } }
    expect(basemapPoiLook([food])?.badges).toBe(true)
  })

  test('is null for a style with no POI labels', () => {
    expect(basemapPoiLook(layers.slice(0, 2))).toBeNull()
  })
})
