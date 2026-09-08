/**
 * Switching the Transit group off has to take the network off the map, and
 * switching it back on has to put it there again.
 *
 * Both halves used to hang on one misreading of `isStyleLoaded()`, which is
 * a claim about every source cache in the style and so reads false whenever
 * any one of ninety pyramids has a tile in flight — which is exactly the
 * moment a rider touches the switch. Teardown skipped its removal and left
 * the whole network painted; the rebuild deferred itself to an `idle` event
 * that a map with nothing left to draw never fires.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('maplibre-gl', () => ({ getVersion: () => '6.4.1-transit.3' }))
vi.mock('@/router', () => ({ default: {}, AppRoute: {} }))
vi.mock('@/lib/api', () => ({ api: { defaults: { baseURL: 'http://test' } } }))

import { usePortolanTransitService } from './portolan-transit.service'
import { MapEngine, MapTheme } from '@/types/map.types'

const FLAG_KEY = 'parchment.portolan-transit'

/** A map whose style already carries a built portolan network. */
function fakeMap(opts: { styleLoaded?: boolean } = {}) {
  const layers = [
    { id: 'background' },
    { id: 'road-label' },
    { id: 'portolan-ribbon-1-steady-nyc' },
    { id: 'portolan-station-markers' },
  ]
  const sources: Record<string, unknown> = {
    basemap: {},
    'portolan-tiles-nyc': {},
    'portolan-stations': {},
  }
  return {
    style: {},
    isStyleLoaded: () => opts.styleLoaded ?? false,
    // Both engines serialize on getStyle(); copies, or removal would be
    // walking the array it is splicing.
    getStyle: () => ({ layers: [...layers], sources: { ...sources } }),
    getLayer: (id: string) => layers.find(l => l.id === id),
    getSource: (id: string) => sources[id],
    removeLayer: (id: string) => {
      const i = layers.findIndex(l => l.id === id)
      if (i >= 0) layers.splice(i, 1)
    },
    removeSource: (id: string) => {
      delete sources[id]
    },
    on: () => {},
    off: () => {},
    once: vi.fn(),
    layers,
    sources,
  }
}

function strategyFor(map: unknown) {
  return {
    mapInstance: map,
    options: { engine: MapEngine.MAPLIBRE, theme: MapTheme.LIGHT },
  } as any
}

const portolanIds = (map: ReturnType<typeof fakeMap>) => ({
  layers: map.layers.filter(l => l.id.startsWith('portolan-')).map(l => l.id),
  sources: Object.keys(map.sources).filter(s => s.startsWith('portolan-')),
})

describe('portolan teardown', () => {
  beforeEach(() => {
    // The dev flag is the enablement path that needs no pinia.
    localStorage.setItem(FLAG_KEY, '1')
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve([]) })),
    )
  })

  afterEach(() => {
    localStorage.removeItem(FLAG_KEY)
    vi.unstubAllGlobals()
  })

  test('removes every portolan layer and source while tiles are still in flight', () => {
    const service = usePortolanTransitService()
    const map = fakeMap({ styleLoaded: false })

    service.initializePortolanTransit(strategyFor(map))
    expect(portolanIds(map).layers.length).toBeGreaterThan(0)

    service.teardownPortolanTransit()

    expect(portolanIds(map)).toEqual({ layers: [], sources: [] })
  })

  test('leaves the basemap alone', () => {
    const service = usePortolanTransitService()
    const map = fakeMap({ styleLoaded: true })

    service.initializePortolanTransit(strategyFor(map))
    service.teardownPortolanTransit()

    expect(map.layers.map(l => l.id)).toEqual(['background', 'road-label'])
    expect(Object.keys(map.sources)).toEqual(['basemap'])
  })

  test('is safe on a map with no style at all', () => {
    const service = usePortolanTransitService()
    const map = { ...fakeMap(), style: null }

    service.initializePortolanTransit(strategyFor(map))
    expect(() => service.teardownPortolanTransit()).not.toThrow()
  })
})
