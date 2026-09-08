import { describe, test, expect } from 'vitest'
import { buildMapStyle, layerGroups } from '@/lib/map-style'
import { firstLabelLayerId } from './portolan-anchors'

const STACK = [
  { id: 'Oneway', type: 'symbol' },
  { id: 'Building', type: 'fill' },
  { id: 'Building 3D', type: 'fill-extrusion' },
  { id: 'River labels', type: 'symbol' },
  { id: 'portolan-station-labels', type: 'symbol' },
]

describe('firstLabelLayerId', () => {
  test('finds the basemap\'s first label layer, never one of ours', () => {
    expect(firstLabelLayerId(STACK)).toBe('Oneway')
    expect(firstLabelLayerId([{ id: 'portolan-cats', type: 'symbol' }])).toBeUndefined()
  })

  test('skips symbol layers drawn below the layer it must clear', () => {
    expect(firstLabelLayerId(STACK, 'Building 3D')).toBe('River labels')
  })

  test('falls back to the whole stack when the layer to clear is absent', () => {
    expect(firstLabelLayerId(STACK, 'Building 3D (mapbox)')).toBe('Oneway')
  })

  test('the real style has a label layer above the buildings for the ghost ribbon', () => {
    // The ghost is the only thing that keeps a route readable where it passes
    // behind a tower, and it only works anchored above the extrusion.
    const layers = buildMapStyle({ tileServerUrl: 'https://example.test/tiles' } as any).layers
    const anchor = firstLabelLayerId(layers, layerGroups.building3d)
    expect(anchor).toBeTruthy()
    const index = (id?: string) => layers.findIndex(l => l.id === id)
    expect(index(anchor)).toBeGreaterThan(index(layerGroups.building3d))
  })
})
