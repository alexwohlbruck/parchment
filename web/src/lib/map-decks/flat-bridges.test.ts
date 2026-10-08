import { describe, test, expect } from 'vitest'
import { buildMapStyle } from '@/lib/map-style/build'
import { flatBridgeOpacity } from './flat-bridges'

describe('flatBridgeOpacity', () => {
  const layers = buildMapStyle({ tileServerUrl: 'https://example.test/tiles', theme: 'light' } as any).layers as any[]
  const muted = (id: string) => {
    const layer = layers.find(l => l.id === id)
    expect(layer, id).toBeDefined()
    return flatBridgeOpacity(layer)
  }

  test('mutes every flat copy of a bridge, its area included', () => {
    expect(muted('Bridge')).toBe('fill-opacity')
    expect(muted('Bridge area outline')).toBe('line-opacity')
    expect(muted('Major road bridge')).toBe('line-opacity')
    expect(muted('Road surface bridge')).toBe('fill-opacity')
    expect(muted('Road glyph bridge')).toBe('icon-opacity')
  })

  test('leaves what runs under a bridge alone', () => {
    for (const id of ['Major road', 'Highway', 'Road surface', 'Road glyph']) expect(muted(id), id).toBeNull()
  })
})
