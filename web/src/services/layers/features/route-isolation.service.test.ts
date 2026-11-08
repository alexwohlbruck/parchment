import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useRouteDetailStore } from '@/stores/route-detail.store'
import { useRouteIsolationService } from './route-isolation.service'

// Portolan on, but nothing under this route: a city with no pyramid.
vi.mock('@/services/layers/features/portolan/portolan-transit.service', () => ({
  usePortolanTransitService: () => ({
    isPortolanTransitEnabled: () => true,
    portolanTransitActive: () => false,
    portolanRouteToken: () => null,
    setIsolatedRoute: vi.fn(),
    setIsolatedRouteGeometry: vi.fn(),
    setIsolatedRouteStops: vi.fn(),
    setStopService: vi.fn(),
  }),
}))
vi.mock('@/services/layers/features/transit-network-dim', () => ({
  fadeTransitNetwork: vi.fn(),
  networkDimOpacity: () => 0.3,
}))

function host() {
  const layers = new Map<string, any>()
  const sources = new Map<string, any>()
  const listeners = new Map<string, Set<() => void>>()
  const map = {
    getLayer: (id: string) => layers.get(id),
    getSource: (id: string) => sources.get(id),
    addSource: vi.fn((id, value) => sources.set(id, value)),
    addLayer: vi.fn(value => layers.set(value.id, value)),
    removeLayer: (id: string) => layers.delete(id),
    removeSource: (id: string) => sources.delete(id),
    fitBounds: vi.fn(),
    on: (event: string, fn: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(fn)
    },
    off: (event: string, fn: () => void) => listeners.get(event)?.delete(fn),
  }
  const emit = (event: string) => [...(listeners.get(event) ?? [])].forEach(fn => fn())
  return { map, layers, listeners, emit }
}

const stop = (id: string, lat: number, lng: number, along: number) => ({
  stopId: id,
  stopName: id,
  lat,
  lng,
  distanceAlongRoute: along,
  routes: [],
})

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.useRealTimers())

describe('route isolation without a pyramid', () => {
  it('draws the overlay even when the settled map fires idle only once', async () => {
    vi.useFakeTimers()
    const h = host()
    const store = useRouteDetailStore()
    const service = useRouteIsolationService()
    service.initialize(h.map)

    store.activeRoute = {
      feedId: '886',
      routeId: '9',
      routeShortName: '9',
      routeLongName: 'Central Avenue',
      routeColor: null,
      routeTextColor: null,
      routeType: 3,
      agencyName: null,
      bikesAllowed: 0,
      stops: [stop('a', 35.2, -80.8, 0), stop('b', 35.21, -80.7, 1000)],
      coordinates: [[-80.8, 35.2], [-80.7, 35.21]],
      relatedRouteIds: [],
    } as any
    await nextTick()

    h.emit('idle')
    expect(h.layers.has('route-detail-line')).toBe(false)

    vi.advanceTimersByTime(3000)
    expect(h.layers.has('route-detail-line')).toBe(true)
    expect(h.listeners.get('idle')?.size ?? 0).toBe(0)

    service.destroy()
  })
})
