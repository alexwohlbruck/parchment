import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachPoiElevation } from './poi-elevation.service'
import * as heights from '@/lib/map/poi-elevation'

vi.mock('@/lib/map-style', () => ({ layerGroups: { building3d: 'buildings' } }))
vi.mock('@/constants/layers', () => ({ COLLECTION_MARKERS_SOURCE_ID: 'collections', SEARCH_RESULTS_SOURCE_ID: 'search' }))

function fixture(count = 1) {
  const handlers = new Map<string, Set<(event?: any) => void>>()
  const layers = new Map<string, any>([
    ['buildings', { id: 'buildings', type: 'fill-extrusion', source: 'detail', sourceLayer: 'building' }],
    ['poi', { id: 'poi', type: 'symbol', source: 'basemap', 'source-layer': 'poi' }],
  ])
  const sources = new Map<string, any>()
  let height = 40
  let tile = 1
  const pois = Array.from({ length: count }, (_, id) => ({ id, properties: { name: `POI ${id}` }, geometry: { type: 'Point', coordinates: [0.0001, 0.0001] } }))
  const map = {
    on: (event: string, handler: (event?: any) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler)
    },
    off: (event: string, handler: (event?: any) => void) => handlers.get(event)?.delete(handler),
    emit: (event: string, data?: any) => handlers.get(event)?.forEach(handler => handler(data)),
    getLayer: (id: string) => layers.get(id),
    getSource: (id: string) => sources.get(id),
    getStyle: () => ({ layers: [...layers.values()] }),
    getLayersOrder: () => [...layers.keys()],
    addSource: (id: string) => sources.set(id, { setData: vi.fn() }),
    addLayer: (layer: any) => layers.set(layer.id, layer),
    removeLayer: (id: string) => layers.delete(id),
    getLayoutProperty: vi.fn(),
    setLayoutProperty: vi.fn(),
    querySourceFeatures: vi.fn((_source: string, options: any) => options.sourceLayer === 'poi' ? pois : [{
      _z: 14, _x: tile, _y: 1,
      properties: { height },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]] },
    }]),
  }
  return { map, sources, setHeight: (value: number) => { height = value }, setTile: (value: number) => { tile = value } }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const settle = () => vi.advanceTimersByTime(2000)

describe('POI elevation hydration', () => {
  it('raises POIs and reuses their building index and heights on unchanged tile events', () => {
    const { map, sources } = fixture()
    const index = vi.spyOn(heights, 'footprintIndex')
    const elevation = vi.spyOn(heights, 'poiElevation')
    const attached = attachPoiElevation(map, () => true)
    settle()
    expect(sources.get('poi-dots-raised').setData.mock.calls[0][0].features[0].properties._elev).toBe(40.5)
    const reads = elevation.mock.calls.length
    map.emit('sourcedata', { sourceId: 'detail', tile: {} })
    settle()
    expect(index).toHaveBeenCalledTimes(1)
    expect(elevation).toHaveBeenCalledTimes(reads)
    expect(sources.get('poi-dots-raised').setData).toHaveBeenCalledTimes(1)
    attached.detach()
  })

  it('skips source scans on unchanged idle events', () => {
    const { map } = fixture()
    const attached = attachPoiElevation(map, () => true)
    settle()
    map.querySourceFeatures.mockClear()
    map.emit('idle')
    settle()
    expect(map.querySourceFeatures).not.toHaveBeenCalled()
    attached.detach()
  })

  it('updates elevations when building tiles arrive without a POI source event', () => {
    const { map, sources, setHeight, setTile } = fixture()
    const attached = attachPoiElevation(map, () => true)
    settle()
    setHeight(80)
    setTile(2)
    map.emit('sourcedata', { sourceId: 'detail', tile: {} })
    settle()
    expect(sources.get('poi-dots-raised').setData.mock.lastCall![0].features[0].properties._elev).toBe(80.5)
    attached.detach()
  })

  it('discards cached footprints when a style is refreshed and when elevation is disabled', () => {
    const { map, sources, setHeight } = fixture()
    let raised = true
    const attached = attachPoiElevation(map, () => raised)
    settle()
    setHeight(80)
    attached.refresh()
    settle()
    expect(sources.get('poi-dots-raised').setData.mock.lastCall![0].features[0].properties._elev).toBe(80.5)
    raised = false
    attached.refresh()
    settle()
    expect(sources.get('poi-dots-raised').setData.mock.lastCall![0].features[0].properties._elev).toBe(0)
    attached.detach()
  })

  it('yields between chunks and cancels unfinished hydration on detach', () => {
    const { map, sources } = fixture(400)
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now += 5)
    const attached = attachPoiElevation(map, () => true)
    vi.advanceTimersByTime(32)
    expect(sources.get('poi-dots-raised')?.setData).not.toHaveBeenCalled()
    attached.detach()
    settle()
    expect(sources.get('poi-dots-raised')?.setData).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
