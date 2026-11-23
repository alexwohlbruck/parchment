import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { computed, effectScope, nextTick, reactive } from 'vue'
import { useDockWatch } from './useDockWatch'
import { fetchAlternatives, fetchStation } from '@/services/guidance/dock-watch.service'

const ride = {
  mode: 'cycling',
  ownership: 'shared',
  geometry: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }],
  sharedMobilityDetails: { toStationName: 'College St' },
}
const walk = { mode: 'walking', geometry: [{ lat: 0, lng: 0.01 }, { lat: 0, lng: 0.012 }] }

const guidance = reactive({
  segments: [ride, walk] as unknown[],
  route: { segments: [{ index: 0, startDistance: 0, endDistance: 1000, mode: 'cycling' }, { index: 1, startDistance: 1000, endDistance: 1200, mode: 'walking' }] },
  progress: { puck: { s: 100, position: { lat: 0, lng: 0.001 } } },
  preferences: { autoSwitchDocks: true },
  switchDock: vi.fn(async () => true),
})

vi.mock('@/stores/guidance.store', () => ({ useGuidanceStore: () => guidance }))
vi.mock('@/composables/usePremiumNavigation', () => ({ usePremiumNavigation: () => computed(() => true) }))
vi.mock('@/lib/guidance/nav-route', () => ({
  segmentAt: (route: typeof guidance.route, s: number) => [...route.segments].reverse().find(seg => seg.startDistance <= s) ?? null,
}))
vi.mock('@/services/guidance/dock-watch.service', () => ({ fetchStation: vi.fn(), fetchAlternatives: vi.fn(async () => []) }))

const status = (docks: number) => ({ stationId: 'college', name: 'College St', bikes: 0, docks })

describe('useDockWatch', () => {
  let scope: ReturnType<typeof effectScope>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(fetchStation).mockReset().mockResolvedValue(status(10))
    vi.mocked(fetchAlternatives).mockClear()
    guidance.segments = [ride, walk]
    scope = effectScope()
  })
  afterEach(() => {
    scope.stop()
    vi.useRealTimers()
  })

  const checks = () => vi.mocked(fetchStation).mock.calls.length

  test('keeps checking after a reroute lands mid-check', async () => {
    let release!: (value: ReturnType<typeof status>) => void
    vi.mocked(fetchStation).mockImplementationOnce(() => new Promise(resolve => (release = resolve)))
    scope.run(() => useDockWatch())
    await nextTick()
    guidance.segments = [{ ...ride }, walk]
    await nextTick()
    release(status(10))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(checks()).toBe(2)
  })

  test('keeps checking after a check fails', async () => {
    vi.mocked(fetchStation).mockRejectedValueOnce(new Error('offline'))
    scope.run(() => useDockWatch())
    await vi.advanceTimersByTimeAsync(30_000)
    expect(checks()).toBe(2)
  })

  test('asks for the picker once the dock is full', async () => {
    vi.mocked(fetchStation).mockResolvedValue(status(0))
    vi.mocked(fetchAlternatives).mockResolvedValue([
      { stationId: 'w3', name: 'W 3 St', location: { lat: 0, lng: 0.011 }, available: 8, fromOriginal: 120, toTarget: 200 },
    ])
    const docks = scope.run(() => useDockWatch())!
    await vi.advanceTimersByTimeAsync(0)
    expect(docks.risk.value).toBe('gone')
    expect(docks.pickRequested.value).toBe(true)
    expect(docks.options.value.map(o => o.id)).toEqual(['w3'])
  })
  test('never sends the rider back to a station it switched away from', async () => {
    const college = { stationId: 'college', name: 'College St', location: { lat: 0, lng: 0.01 }, available: 8, fromOriginal: 120, toTarget: 200 }
    const w3 = { stationId: 'w3', name: 'W 3 St', location: { lat: 0, lng: 0.011 }, available: 8, fromOriginal: 120, toTarget: 300 }
    vi.mocked(fetchStation).mockResolvedValue(status(0))
    vi.mocked(fetchAlternatives).mockResolvedValue([w3])
    const docks = scope.run(() => useDockWatch())!
    await vi.advanceTimersByTimeAsync(0)
    await docks.pick(w3)
    vi.mocked(fetchStation).mockResolvedValue({ ...status(0), stationId: 'w3' })
    vi.mocked(fetchAlternatives).mockResolvedValue([college, w3])
    guidance.segments = [{ ...ride, geometry: [{ lat: 0, lng: 0 }, w3.location] }, walk]
    await vi.advanceTimersByTimeAsync(0)
    expect(docks.options.value.map(o => o.id)).toEqual(['w3'])
  })
})
