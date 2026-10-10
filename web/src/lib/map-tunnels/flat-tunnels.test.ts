import { describe, test, expect } from 'vitest'
import { buildMapStyle } from '@/lib/map-style/build'
import { expression } from '@maplibre/maplibre-gl-style-spec'
import { TUNNEL_MIN_ZOOM, isFlatTunnel, mutedTunnelOpacity } from './flat-tunnels'

describe('flat tunnels', () => {
  const layers = buildMapStyle({ tileServerUrl: 'https://example.test/tiles', theme: 'light', hdRoads: true } as any).layers as any[]

  test('are the road tunnels, not footway or railway ones', () => {
    expect(layers.filter(isFlatTunnel).map(l => l.id)).toEqual(['Tunnel outline', 'Tunnel'])
    expect(layers.some(l => l.id === 'Railway tunnel' && !isFlatTunnel(l))).toBe(true)
  })

  test('fade out from street zoom where the tunnel runs underground, and stay under a building', () => {
    const compiled = expression.createExpression(mutedTunnelOpacity(0.6), { type: 'number' } as any) as any
    const opacity = (zoom: number, properties: Record<string, unknown>) =>
      compiled.value.evaluate({ zoom }, { type: 2, properties })
    expect(opacity(TUNNEL_MIN_ZOOM - 1, { layer: -1 })).toBe(0.6)
    expect(opacity(TUNNEL_MIN_ZOOM, { layer: -1 })).toBe(0)
    expect(opacity(TUNNEL_MIN_ZOOM, {})).toBe(0.6)
    expect(opacity(TUNNEL_MIN_ZOOM, { layer: 0 })).toBe(0.6)
  })
})
