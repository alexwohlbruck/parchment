import { describe, expect, test, vi } from 'vitest'
import { ResultMarkersLayer } from './result-markers-layer'
import type { MapStrategy } from '@/services/map/providers/map.strategy'

vi.mock('@/lib/map-style/badge-art', () => ({
  spriteLoaded: () => true,
  ensurePoiBadge: async (_map: unknown, icon: { name: string }) => `badge-${icon.name}`,
}))

function fakeMap() {
  const handlers: Record<string, (e: unknown) => void> = {}
  const source = { setData: vi.fn() }
  const map = {
    getStyle: () => ({ layers: [] }),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getSource: () => source,
    getLayer: () => true,
    removeLayer: vi.fn(),
    removeSource: vi.fn(),
    getCanvas: () => ({ style: {} }),
    on: (type: string, _layer: string, handler: (e: unknown) => void) => (handlers[type] = handler),
    off: vi.fn(),
  }
  return { map, handlers, source }
}

const colors = { plate: '#f93', ink: '#a50', ring: '#fff', lift: '#000' }

describe('ResultMarkersLayer', () => {
  test('numbers each place in list order, with its own badge and name', async () => {
    const { map, source } = fakeMap()
    const layer = new ResultMarkersLayer({ mapInstance: map, dispatchPoiClick: vi.fn() } as unknown as MapStrategy, () => {})
    await layer.setMarkers([
      { location: { lat: 1, lng: 2 }, name: 'Deck', colors },
      { location: { lat: 3, lng: 4 }, name: 'Lot', colors },
    ])
    const { features } = source.setData.mock.calls[0][0]
    expect(features.map((f: { properties: object }) => f.properties)).toEqual([
      { n: 1, name: 'Deck', image: 'badge-1', ink: '#a50' },
      { n: 2, name: 'Lot', image: 'badge-2', ink: '#a50' },
    ])
  })

  test('a tap on a badge picks that place, as a POI tap', () => {
    const { map, handlers } = fakeMap()
    const onPick = vi.fn()
    const dispatchPoiClick = vi.fn((_e: unknown, action: () => void) => (action(), true))
    new ResultMarkersLayer({ mapInstance: map, dispatchPoiClick } as unknown as MapStrategy, onPick)
    handlers.click({ features: [{ properties: { n: 2 } }] })
    expect(onPick).toHaveBeenCalledWith(1)
  })
})
