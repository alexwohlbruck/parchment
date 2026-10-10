import { describe, test, expect } from 'vitest'
import { buildMapStyle } from '@/lib/map-style/build'
import { expression } from '@maplibre/maplibre-gl-style-spec'
import { TUNNEL_MIN_ZOOM, isFlatTunnel, mutedTunnelOpacity } from './flat-tunnels'

describe('flat tunnels', () => {
  const layers = buildMapStyle({ tileServerUrl: 'https://example.test/tiles', theme: 'light', hdRoads: true } as any).layers as any[]

  test('are the road, footway and railway tunnels, not waterways', () => {
    expect(layers.filter(isFlatTunnel).map(l => l.id).sort()).toEqual(
      ['Footway tunnel', 'Footway tunnel outline', 'Railway tunnel', 'Railway tunnel hatching', 'Tunnel', 'Tunnel outline'])
  })

  test('take in a cycling mark on a tunnel, but not one on a way at grade', () => {
    expect(isFlatTunnel({ id: 'bicycle-cycleways-tunnel', type: 'line', 'source-layer': 'bicycle_ways', filter: ['all', ['==', 'highway', 'cycleway'], ['==', 'tunnel', true]] })).toBe(true)
    expect(isFlatTunnel({ id: 'bicycle-cycleways', type: 'line', 'source-layer': 'bicycle_ways', filter: ['all', ['!=', 'bridge', true], ['!=', 'tunnel', true]] })).toBe(false)
  })

  test('fade out from street zoom where the tunnel runs underground, and stay under a building', () => {
    const compiled = expression.createExpression(mutedTunnelOpacity(0.6, { id: 'Tunnel', type: 'line', 'source-layer': 'transportation' }), { type: 'number' } as any) as any
    const opacity = (zoom: number, properties: Record<string, unknown>) =>
      compiled.value.evaluate({ zoom }, { type: 2, properties })
    expect(opacity(TUNNEL_MIN_ZOOM - 1, { layer: -1 })).toBe(0.6)
    expect(opacity(TUNNEL_MIN_ZOOM, { layer: -1 })).toBe(0)
    expect(opacity(TUNNEL_MIN_ZOOM, {})).toBe(0.6)
    expect(opacity(TUNNEL_MIN_ZOOM, { layer: 0 })).toBe(0.6)
  })
})
