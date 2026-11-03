import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MapStrategy } from '@/services/map/providers/map.strategy'
import { MapEngine, MapProjection, type Layer } from '@/types/map.types'
import { useDayNightLayerService } from './daynight-layer.service'

vi.mock('@/lib/daynight/daynight-canvas', () => ({
  renderDayNightCanvas: () => ({ toDataURL: () => 'data:image/png;base64,test' }),
}))

function host(engine = MapEngine.MAPLIBRE) {
  const layers = new Map<string, any>()
  const sources = new Map<string, any>()
  const listeners = new Map<string, Set<() => void>>()
  const map = {
    getLayer: (id: string) => layers.get(id),
    getSource: (id: string) => sources.get(id),
    addSource: vi.fn((id, value) => sources.set(id, { ...value, updateImage: vi.fn() })),
    addLayer: vi.fn(value => layers.set(value.id, value)),
    fire: vi.fn(),
    setPaintProperty: vi.fn((id, name, value) => { layers.get(id).paint[name] = value }),
    on: (event: string, fn: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(fn)
    },
    off: (event: string, fn: () => void) => listeners.get(event)?.delete(fn),
  }
  const options = { engine, projection: MapProjection.GLOBE }
  const strategy = { mapInstance: map, options } as unknown as MapStrategy
  const layer = { visible: true, configuration: { id: 'daynight-overlay' } } as Layer
  const emit = (event: string) => [...(listeners.get(event) ?? [])].forEach(fn => fn())
  return { map, options, strategy, layer, layers, sources, listeners, emit }
}

afterEach(() => vi.useRealTimers())

describe('day/night layer lifecycle', () => {
  it('restores the source and layer after style replacement with one refresh timer', () => {
    vi.useFakeTimers()
    const h = host()
    const service = useDayNightLayerService()
    service.initializeDayNightLayer(h.strategy, h.layer)
    h.layers.clear()
    h.sources.clear()
    service.initializeDayNightLayer(h.strategy, h.layer)
    expect(h.map.addLayer).toHaveBeenCalledTimes(2)
    expect(h.map.addSource).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(1)
    expect(h.listeners.get('projectiontransition')?.size).toBe(1)
    vi.advanceTimersByTime(60_000)
    expect(h.sources.get('daynight').updateImage).toHaveBeenCalledOnce()
    h.emit('remove')
    expect(vi.getTimerCount()).toBe(0)
    expect(h.listeners.get('projectiontransition')?.size).toBe(0)
  })

  it('hands the overlay back to the raster when changing to Mercator', () => {
    vi.useFakeTimers()
    const h = host()
    const service = useDayNightLayerService()
    service.initializeDayNightLayer(h.strategy, h.layer)
    expect(h.layers.get('daynight-overlay').paint['raster-opacity'][4]).toBe(0)
    h.options.projection = MapProjection.MERCATOR
    h.emit('projectiontransition')
    expect(h.layers.get('daynight-overlay').paint['raster-opacity'][4]).toBe(1)
    service.cleanup()
  })

  it('keeps the Mapbox raster and releases its timer when the map is removed', () => {
    vi.useFakeTimers()
    const h = host(MapEngine.MAPBOX)
    useDayNightLayerService().initializeDayNightLayer(h.strategy, h.layer)
    expect(h.layers.get('daynight-overlay').paint['raster-opacity'][4]).toBe(1)
    h.emit('remove')
    expect(vi.getTimerCount()).toBe(0)
  })
})
