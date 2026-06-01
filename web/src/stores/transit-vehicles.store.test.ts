/**
 * Unit tests for transit vehicles store
 *
 * Tests cover:
 * - Polling lifecycle (start/stop)
 * - Vehicle fetching and merging
 * - Stale vehicle pruning
 * - Bounds change detection
 * - Bounds expansion for prefetching
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTransitVehiclesStore } from './transit-vehicles.store'
import type { TransitVehiclePosition } from '@/types/multimodal.types'

// ── Mock API ────────────────────────────────────────────────────────

const mockApiGet = vi.fn()
vi.mock('@/lib/api', () => ({
  api: { get: (...args: any[]) => mockApiGet(...args) },
}))

// ── Helpers ─────────────────────────────────────────────────────────

function makeVehicle(
  id: string,
  lat: number,
  lng: number,
  overrides?: Partial<TransitVehiclePosition>,
): TransitVehiclePosition {
  return {
    vehicleId: id,
    feedId: 'feed-1',
    position: { lat, lng },
    timestamp: new Date().toISOString(),
    routeShortName: '42',
    ...overrides,
  }
}

function makeBounds(
  north = 36,
  south = 35,
  east = -78,
  west = -80,
) {
  return { north, south, east, west }
}

// ── Tests ───────────────────────────────────────────────────────────

describe('useTransitVehiclesStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    mockApiGet.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Initial state', () => {
    test('starts with no vehicles', () => {
      const store = useTransitVehiclesStore()
      expect(store.vehicles.size).toBe(0)
      expect(store.vehicleList).toHaveLength(0)
      expect(store.count).toBe(0)
    })

    test('starts not polling', () => {
      const store = useTransitVehiclesStore()
      expect(store.isPolling).toBe(false)
    })
  })

  describe('startPolling / stopPolling', () => {
    test('sets isPolling true on start', () => {
      const store = useTransitVehiclesStore()
      mockApiGet.mockResolvedValue({ data: { vehicles: [] } })

      store.startPolling(() => makeBounds())
      expect(store.isPolling).toBe(true)
    })

    test('does not start duplicate polling', () => {
      const store = useTransitVehiclesStore()
      mockApiGet.mockResolvedValue({ data: { vehicles: [] } })

      store.startPolling(() => makeBounds())
      store.startPolling(() => makeBounds()) // second call is no-op
      expect(store.isPolling).toBe(true)
      // Only one immediate fetch (not two)
      expect(mockApiGet).toHaveBeenCalledTimes(1)
    })

    test('clears state on stop', async () => {
      const store = useTransitVehiclesStore()
      mockApiGet.mockResolvedValue({
        data: { vehicles: [makeVehicle('v1', 35.5, -79)] },
      })

      store.startPolling(() => makeBounds())
      // Let the immediate fetch resolve
      await vi.advanceTimersByTimeAsync(0)

      store.stopPolling()
      expect(store.isPolling).toBe(false)
      expect(store.vehicles.size).toBe(0)
      expect(store.count).toBe(0)
    })
  })

  describe('fetchVehicles', () => {
    test('populates vehicles from API response', async () => {
      const store = useTransitVehiclesStore()
      mockApiGet.mockResolvedValue({
        data: {
          vehicles: [
            makeVehicle('v1', 35.5, -79),
            makeVehicle('v2', 35.6, -79.1),
          ],
        },
      })

      await store.fetchVehicles(makeBounds())

      expect(store.count).toBe(2)
      expect(store.vehicles.get('v1')).toBeDefined()
      expect(store.vehicles.get('v2')).toBeDefined()
    })

    test('expands bounds by 20% for prefetching', async () => {
      const store = useTransitVehiclesStore()
      mockApiGet.mockResolvedValue({ data: { vehicles: [] } })

      await store.fetchVehicles(makeBounds(36, 35, -78, -80))

      expect(mockApiGet).toHaveBeenCalledWith(
        '/proxy/transit/vehicles',
        expect.objectContaining({
          params: expect.objectContaining({
            north: 36.2,  // 36 + (36-35)*0.2
            south: 34.8,  // 35 - (36-35)*0.2
            east: -77.6,  // -78 + (|-78 - -80|)*0.2
            west: -80.4,  // -80 - (|-78 - -80|)*0.2
          }),
        }),
      )
    })

    test('filters out stale vehicles', async () => {
      const store = useTransitVehiclesStore()
      const now = new Date()
      const threeMinAgo = new Date(now.getTime() - 3 * 60 * 1000)

      mockApiGet.mockResolvedValue({
        data: {
          vehicles: [
            makeVehicle('fresh', 35.5, -79),
            makeVehicle('stale', 35.6, -79.1, {
              timestamp: threeMinAgo.toISOString(),
            }),
          ],
        },
      })

      await store.fetchVehicles(makeBounds())

      expect(store.count).toBe(1)
      expect(store.vehicles.has('fresh')).toBe(true)
      expect(store.vehicles.has('stale')).toBe(false)
    })

    test('merges with previously fetched vehicles that are still in bounds', async () => {
      const store = useTransitVehiclesStore()

      // First fetch: vehicle A
      mockApiGet.mockResolvedValueOnce({
        data: { vehicles: [makeVehicle('vA', 35.5, -79)] },
      })
      await store.fetchVehicles(makeBounds())
      expect(store.count).toBe(1)

      // Second fetch: vehicle B (A not in response but still in bounds)
      mockApiGet.mockResolvedValueOnce({
        data: { vehicles: [makeVehicle('vB', 35.6, -79.1)] },
      })
      await store.fetchVehicles(makeBounds())

      // Both should be present (A retained, B new)
      expect(store.count).toBe(2)
      expect(store.vehicles.has('vA')).toBe(true)
      expect(store.vehicles.has('vB')).toBe(true)
    })

    test('drops previously fetched vehicles that are now out of bounds', async () => {
      const store = useTransitVehiclesStore()

      // First fetch: vehicle far north
      mockApiGet.mockResolvedValueOnce({
        data: { vehicles: [makeVehicle('vFar', 50, -79)] },
      })
      await store.fetchVehicles(makeBounds(51, 49, -78, -80))

      // Second fetch with different bounds — vFar is now outside
      mockApiGet.mockResolvedValueOnce({
        data: { vehicles: [makeVehicle('vNear', 35.5, -79)] },
      })
      await store.fetchVehicles(makeBounds(36, 35, -78, -80))

      expect(store.vehicles.has('vFar')).toBe(false)
      expect(store.vehicles.has('vNear')).toBe(true)
    })

    test('silently handles API errors', async () => {
      const store = useTransitVehiclesStore()
      mockApiGet.mockRejectedValue(new Error('Network error'))

      // Should not throw
      await store.fetchVehicles(makeBounds())
      expect(store.count).toBe(0)
    })
  })

  describe('Polling behavior', () => {
    test('fetches immediately on start then skips when bounds unchanged', async () => {
      const store = useTransitVehiclesStore()
      mockApiGet.mockResolvedValue({ data: { vehicles: [] } })

      store.startPolling(() => makeBounds())

      // Immediate fetch fires (lastFetchedBounds is null)
      expect(mockApiGet).toHaveBeenCalledTimes(1)

      // Let the fetch promise resolve so lastFetchedBounds is set
      await vi.advanceTimersByTimeAsync(0)

      // Advance past poll interval — bounds haven't changed, so the
      // second poll skips the fetch (boundsSignificantlyChanged = false)
      await vi.advanceTimersByTimeAsync(15_000)
      expect(mockApiGet).toHaveBeenCalledTimes(1)

      store.stopPolling()
    })

    test('re-fetches when bounds change significantly', async () => {
      let currentBounds = makeBounds(36, 35, -78, -80)
      const store = useTransitVehiclesStore()
      mockApiGet.mockResolvedValue({ data: { vehicles: [] } })

      store.startPolling(() => currentBounds)
      expect(mockApiGet).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(0)

      // Move bounds significantly (more than 10% of span)
      currentBounds = makeBounds(37, 36, -77, -79)
      await vi.advanceTimersByTimeAsync(15_000)

      // Should have fetched again due to significant bounds change
      expect(mockApiGet).toHaveBeenCalledTimes(2)

      store.stopPolling()
    })

    test('skips null bounds from getBounds', async () => {
      const store = useTransitVehiclesStore()
      mockApiGet.mockResolvedValue({ data: { vehicles: [] } })

      store.startPolling(() => null)

      // Null bounds → pollOnce returns early → no fetch
      expect(mockApiGet).not.toHaveBeenCalled()

      store.stopPolling()
    })
  })

  describe('Computed properties', () => {
    test('vehicleList is an array view of the vehicles map', async () => {
      const store = useTransitVehiclesStore()
      mockApiGet.mockResolvedValue({
        data: {
          vehicles: [
            makeVehicle('v1', 35.5, -79, { routeShortName: 'Blue' }),
            makeVehicle('v2', 35.6, -79.1, { routeShortName: 'Red' }),
          ],
        },
      })

      await store.fetchVehicles(makeBounds())

      expect(store.vehicleList).toHaveLength(2)
      const names = store.vehicleList.map(v => v.routeShortName).sort()
      expect(names).toEqual(['Blue', 'Red'])
    })

    test('count reflects current vehicle count', async () => {
      const store = useTransitVehiclesStore()
      expect(store.count).toBe(0)

      mockApiGet.mockResolvedValue({
        data: { vehicles: [makeVehicle('v1', 35.5, -79)] },
      })
      await store.fetchVehicles(makeBounds())
      expect(store.count).toBe(1)
    })
  })
})
