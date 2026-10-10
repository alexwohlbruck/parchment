import { describe, test, expect } from 'vitest'
import { buildMapStyle } from '@/lib/map-style/build'
import { expression } from '@maplibre/maplibre-gl-style-spec'
import { TUNNEL_MIN_ZOOM, isFlatTunnel, mutedTunnelOpacity } from './flat-tunnels'

describe('flat tunnels', () => {
  const layers = buildMapStyle({ tileServerUrl: 'https://example.test/tiles', theme: 'light', hdRoads: true } as any).layers as any[]

  test('are the road, footway and railway tunnels, and the ways drawn tunnel or not, but not waterways or ways at grade', () => {
    const ids = layers.filter(isFlatTunnel).map(l => l.id)
    expect(ids).toEqual(expect.arrayContaining(['Footway tunnel', 'Railway tunnel', 'Tunnel', 'Minor rail', 'Minor rail hatching', 'Monorail']))
    expect(ids).not.toContain('Minor road')
    expect(ids).not.toContain('River tunnel')
  })

  test('take in a cycling mark on a tunnel, but not one on a way at grade', () => {
    expect(isFlatTunnel({ id: 'bicycle-cycleways-tunnel', type: 'line', 'source-layer': 'bicycle_ways', filter: ['all', ['==', 'highway', 'cycleway'], ['==', 'tunnel', true]] })).toBe(true)
    expect(isFlatTunnel({ id: 'bicycle-cycleways', type: 'line', 'source-layer': 'bicycle_ways', filter: ['all', ['!=', 'bridge', true], ['!=', 'tunnel', true]] })).toBe(false)
  })

  test('fade out from street zoom where the tunnel runs underground, and stay under a building', () => {
    const compiled = expression.createExpression(mutedTunnelOpacity(0.6, { id: 'Tunnel', type: 'line', 'source-layer': 'transportation' }), { type: 'number' } as any) as any
    const opacity = (zoom: number, properties: Record<string, unknown>) =>
      compiled.value.evaluate({ zoom }, { type: 2, properties })
    expect(opacity(TUNNEL_MIN_ZOOM - 1, { brunnel: 'tunnel', layer: -1 })).toBe(0.6)
    expect(opacity(TUNNEL_MIN_ZOOM, { brunnel: 'tunnel', layer: -1 })).toBe(0)
    expect(opacity(TUNNEL_MIN_ZOOM, { brunnel: 'tunnel' })).toBe(0.6)
    expect(opacity(TUNNEL_MIN_ZOOM, { brunnel: 'tunnel', layer: 0 })).toBe(0.6)
  })

  test('keep the opacity a way at grade had, and put out its tunnels', () => {
    const own = ['match', ['get', 'service'], 'yard', 0.5, 1]
    const compiled = expression.createExpression(mutedTunnelOpacity(own, { id: 'Minor rail', type: 'line', 'source-layer': 'transportation' }), { type: 'number' } as any) as any
    const opacity = (properties: Record<string, unknown>) => compiled.value.evaluate({ zoom: TUNNEL_MIN_ZOOM + 1 }, { type: 2, properties })
    expect(opacity({ service: 'yard' })).toBe(0.5)
    expect(opacity({ brunnel: 'tunnel', layer: -1 })).toBe(0)
  })
})
