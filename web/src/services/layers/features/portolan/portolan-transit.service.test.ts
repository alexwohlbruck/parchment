/**
 * Switching the Transit group off takes the network off the map, and
 * switching it back on puts it there again — both while isStyleLoaded() is
 * false, which it is whenever any pyramid has a tile in flight.
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
    // Both engines serialize on getStyle(); copies, or removal walks the
    // array it is splicing.
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
    // The enablement path that needs no pinia.
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

describe('portolan rebuild', () => {
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  afterEach(() => {
    localStorage.removeItem(FLAG_KEY)
    vi.unstubAllGlobals()
  })

  test('retries a style that could not take layers instead of waiting for an idle', async () => {
    // The feed index is probed once per module instance — take a fresh one.
    vi.resetModules()
    localStorage.setItem(FLAG_KEY, '1')
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([{ feed: 'nyc', bounds: [-74.3, 40.5, -73.6, 41], maxzoom: 16 }]),
        }),
      ),
    )
    const { usePortolanTransitService: freshService } = await import(
      './portolan-transit.service'
    )

    // Still being parsed: no layers, so nothing to insert beneath.
    const unparsed = { ...fakeMap(), getStyle: vi.fn(() => ({ layers: [], sources: {} })) }
    const service = freshService()
    service.initializePortolanTransit(strategyFor(unparsed))
    await sleep(50)

    expect(unparsed.once).not.toHaveBeenCalled()
    const firstLook = unparsed.getStyle.mock.calls.length
    await sleep(400)
    expect(unparsed.getStyle.mock.calls.length).toBeGreaterThan(firstLook)

    service.teardownPortolanTransit()
  })
})
