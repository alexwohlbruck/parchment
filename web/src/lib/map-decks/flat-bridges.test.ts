import { describe, test, expect } from 'vitest'
import { buildMapStyle } from '@/lib/map-style/build'
import { isFlatBridge, isFlatBridgeLabel } from './flat-bridges'

const layers = buildMapStyle({ tileServerUrl: 'https://example.test/tiles', theme: 'light', hdRoads: true } as any).layers as any[]
const layer = (id: string) => {
  const found = layers.find(l => l.id === id)
  expect(found, id).toBeDefined()
  return found
}

describe('isFlatBridge', () => {
  test('holds every flat copy of a bridge, its area included', () => {
    for (const id of ['Bridge', 'Bridge area outline', 'Major road bridge', 'Road surface bridge', 'Road glyph bridge']) expect(isFlatBridge(layer(id)), id).toBe(true)
  })

  test('leaves what runs under a bridge alone', () => {
    for (const id of ['Major road', 'Highway', 'Road surface', 'Road glyph']) expect(isFlatBridge(layer(id)), id).toBe(false)
  })
})

describe('isFlatBridgeLabel', () => {
  test('holds road names and arrows, and only those', () => {
    for (const id of ['Road labels', 'Oneway', 'Highway shield']) expect(isFlatBridgeLabel(layer(id)), id).toBe(true)
    expect(isFlatBridgeLabel(layer('Road glyph'))).toBe(false)
  })
})
