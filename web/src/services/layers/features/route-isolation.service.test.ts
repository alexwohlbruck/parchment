import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useRouteDetailStore } from '@/stores/route-detail.store'
import { useRouteIsolationService } from './route-isolation.service'

const portolan = vi.hoisted(() => ({
  active: false,
  token: null as string | null,
  isPortolanTransitEnabled: () => true,
  portolanTransitActive: () => portolan.active,
  portolanRouteToken: () => portolan.token,
  setIsolatedRoute: vi.fn(),
  setIsolatedRouteGeometry: vi.fn(),
  setIsolatedRouteStops: vi.fn(),
  setDrawnRoutes: vi.fn(),
  setNetworkDim: vi.fn(),
  setStopService: vi.fn(),
}))

vi.mock('@/services/layers/features/portolan/portolan-transit.service', () => ({
  usePortolanTransitService: () => portolan,
}))
vi.mock('@/services/layers/features/transit-network-dim', () => ({
  fadeTransitNetwork: vi.fn(),
  networkDimOpacity: () => 0.3,
}))

function host() {
  const layers = new Map<string, any>()
  const sources = new Map<string, any>()
  const listeners = new Map<string, Set<(e?: any) => void>>()
  const map = {
    getLayer: (id: string) => layers.get(id),
    getSource: (id: string) => sources.get(id),
    addSource: vi.fn((id, value) => sources.set(id, value)),
    addLayer: vi.fn(value => layers.set(value.id, value)),
    removeLayer: (id: string) => layers.delete(id),
    removeSource: (id: string) => sources.delete(id),
    fitBounds: vi.fn(),
    on: (event: string, fn: (e?: any) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(fn)
    },
    off: (event: string, fn: (e?: any) => void) => listeners.get(event)?.delete(fn),
  }
  const emit = (event: string, e?: any) =>
    [...(listeners.get(event) ?? [])].forEach(fn => fn(e))
  const listening = () =>
    [...listeners.values()].reduce((n, set) => n + set.size, 0)
  return { map, layers, emit, listening }
}

const stop = (id: string, lat: number, lng: number, along: number, routes: any[] = []) => ({
  stopId: id,
  stopName: id,
  lat,
  lng,
  distanceAlongRoute: along,
  routes,
})

const transfer = {
  routeId: '3',
  routeShortName: '3',
  routeLongName: null,
  routeType: 3,
  routeColor: '8B5A2B',
  routeTextColor: 'FFFFFF',
  agencyName: null,
  via: 'transfer',
}

async function openRoute() {
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
    stops: [stop('a', 35.2, -80.8, 0, [transfer]), stop('b', 35.21, -80.7, 1000)],
    coordinates: [[-80.8, 35.2], [-80.7, 35.21]],
    relatedRouteIds: [],
  } as any
  await nextTick()
  return { h, service }
}

beforeEach(() => {
  setActivePinia(createPinia())
  portolan.active = false
  portolan.token = null
  vi.clearAllMocks()
})
afterEach(() => vi.useRealTimers())

describe('route isolation without a pyramid', () => {
  it('draws the plain overlay when portolan never comes up, even if idle fires only once', async () => {
    vi.useFakeTimers()
    const { h, service } = await openRoute()

    h.emit('idle')
    expect(h.layers.has('route-detail-line')).toBe(false)

    vi.advanceTimersByTime(3000)
    expect(h.layers.has('route-detail-line')).toBe(true)

    service.destroy()
  })

  it('has portolan draw the route itself, with its stops and their bullets', async () => {
    vi.useFakeTimers()
    portolan.active = true
    const { h, service } = await openRoute()

    vi.advanceTimersByTime(3000)
    expect(h.layers.has('route-detail-line')).toBe(false)
    expect(portolan.setNetworkDim).toHaveBeenLastCalledWith(true)
    const [routes] = portolan.setDrawnRoutes.mock.lastCall!
    expect(routes).toHaveLength(1)
    expect(routes[0].coordinates).toHaveLength(2)
    expect(routes[0].stops.map((s: any) => s.name)).toEqual(['a', 'b'])
    // the line's own bullet, then the connection
    expect(routes[0].stops[0].bullets.map((b: any) => b.label).sort()).toEqual(['3', '9'])
    expect(routes[0].stops[1].bullets.map((b: any) => b.label)).toEqual(['9'])

    service.destroy()
    expect(portolan.setDrawnRoutes).toHaveBeenLastCalledWith(null)
    expect(portolan.setNetworkDim).toHaveBeenLastCalledWith(false)
  })

  it('hands the route to its pyramid when the tiles answer after the fallback', async () => {
    vi.useFakeTimers()
    portolan.active = true
    const { h, service } = await openRoute()
    vi.advanceTimersByTime(3000)
    expect(portolan.setIsolatedRoute).not.toHaveBeenCalled()

    portolan.token = 'f3:G'
    h.emit('sourcedata', { sourceId: 'portolan-tiles-nyc', isSourceLoaded: true })
    expect(portolan.setIsolatedRoute).toHaveBeenLastCalledWith('f3:G')
    expect(portolan.setDrawnRoutes).toHaveBeenLastCalledWith(null)
    expect(h.listening()).toBe(0)

    service.destroy()
    expect(portolan.setIsolatedRoute).toHaveBeenLastCalledWith(null)
  })
})
