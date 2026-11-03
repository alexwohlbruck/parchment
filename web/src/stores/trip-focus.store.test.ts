import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, reactive } from 'vue'
import { useTripFocusStore } from './trip-focus.store'

const state = vi.hoisted(() => ({ directions: null as any, guidance: null as any }))
vi.mock('@/stores/directions.store', () => ({ useDirectionsStore: () => state.directions }))
vi.mock('@/stores/guidance.store', () => ({ useGuidanceStore: () => state.guidance }))
vi.mock('@/lib/transit/transit-vehicle-fetch', () => ({ fetchVehiclesOnRoutes: vi.fn().mockResolvedValue([]) }))

const ride = (route: string, trip: string, color: string) => ({
  mode: 'transit',
  lineColor: color,
  transitDetails: {
    route: { id: `feed_${route}`, color },
    trip: { id: `feed_${trip}` },
    stops: [
      { id: 'feed_start', name: 'Start', location: { lat: 40, lng: -74 } },
      { id: 'feed_end', name: 'End', location: { lat: 40.01, lng: -74 } },
    ],
  },
})

beforeEach(() => {
  setActivePinia(createPinia())
  state.directions = reactive({ trips: { trips: [{ id: 'preview', segments: [ride('Q', 'q-run', 'FF6319')] }] }, selectedTripId: 'preview' })
  state.guidance = reactive({ isActive: false, kind: 'route', segments: [] })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('trip focus during navigation', () => {
  test('uses the navigated and replanned legs, then restores the preview on exit', async () => {
    const store = useTripFocusStore()
    store.setLegTripIds({ 0: 'board-run' })
    expect(store.legs[0].tripId).toBe('board-run')
    state.guidance.segments = [ride('2', '2-run', 'EE352E')]
    state.guidance.isActive = true
    state.directions.selectedTripId = null
    expect(store.legs[0]).toMatchObject({ routeIds: ['2'], tripId: '2-run', color: '#EE352E', stops: [{ name: 'Start' }, { name: 'End' }] })
    state.guidance.segments = [ride('4', '4-run', '00933C')]
    expect(store.legs[0].routeIds).toEqual(['4'])
    state.guidance.isActive = false
    expect(store.legs[0].routeIds).toEqual(['Q'])
    await nextTick()
    store.$dispose()
  })

  test('free roam clears the itinerary focus', () => {
    state.guidance.isActive = true
    state.guidance.kind = 'free'
    const store = useTripFocusStore()
    expect(store.hasFocusedTrip).toBe(false)
    expect(store.legs).toEqual([])
    store.$dispose()
  })
})
