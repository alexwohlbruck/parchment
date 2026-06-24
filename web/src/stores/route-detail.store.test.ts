/**
 * Unit tests for the route-detail store.
 *
 * Tests the vehicle projection, direction filtering, and state
 * management logic. Mocks the API layer.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useRouteDetailStore, type RouteDetailStop, type VehicleOnRoute } from './route-detail.store'
import type { TransitVehiclePosition } from '@/types/multimodal.types'

// Mock the API and realtime modules
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: { vehicles: [] } }),
  },
}))

vi.mock('@/lib/realtime', () => ({
  send: vi.fn(),
  connectionState: { value: 'open' },
}))

vi.mock('@/lib/realtime-events', () => ({
  registerRealtimeHandlers: vi.fn(),
}))

function makeStop(id: string, name: string, lat: number, lng: number, dist: number): RouteDetailStop {
  return { stopId: id, stopName: name, lat, lng, distanceAlongRoute: dist }
}

function makeVehicle(
  id: string,
  lat: number,
  lng: number,
  opts: Partial<TransitVehiclePosition> = {},
): TransitVehiclePosition {
  return {
    vehicleId: id,
    feedId: '886',
    position: { lat, lng },
    timestamp: new Date().toISOString(),
    ...opts,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('route-detail store state management', () => {
  test('isActive is false by default', () => {
    const store = useRouteDetailStore()
    expect(store.isActive).toBe(false)
    expect(store.activeRoute).toBeNull()
  })

  test('closeRoute clears all state', () => {
    const store = useRouteDetailStore()
    store.selectVehicle('test-123')
    store.closeRoute()
    expect(store.selectedVehicleId).toBeNull()
    expect(store.vehicles.size).toBe(0)
    expect(store.isActive).toBe(false)
  })

  test('selectVehicle and deselect', () => {
    const store = useRouteDetailStore()
    store.selectVehicle('v1')
    expect(store.selectedVehicleId).toBe('v1')
    store.selectVehicle(null)
    expect(store.selectedVehicleId).toBeNull()
  })

  test('setDirection updates activeDirection', () => {
    const store = useRouteDetailStore()
    store.setDirection('North to UNCC')
    expect(store.selectedDirection).toBe('North to UNCC')
  })
})

describe('direction derivation', () => {
  test('derives directions from first/last stop when no departure context', () => {
    const store = useRouteDetailStore()
    // Simulate setting activeRoute directly for testing
    ;(store as any).activeRoute = {
      feedId: '886',
      routeId: '510',
      routeShortName: '510',
      routeLongName: 'Gold Line',
      routeColor: null,
      routeTextColor: null,
      routeType: 0,
      agencyName: null,
      stops: [
        makeStop('1', 'Sunnyside', 35.22, -80.83, 0),
        makeStop('2', 'Middle', 35.23, -80.84, 500),
        makeStop('3', 'French St', 35.24, -80.85, 1000),
      ],
      coordinates: null,
      relatedRouteIds: [],
    }

    expect(store.directions).toHaveLength(2)
    expect(store.directions[0]).toBe('To French St')
    expect(store.directions[1]).toBe('To Sunnyside')
  })
})

describe('displayStops direction reversal', () => {
  test('displayStops reverses when second direction is selected', () => {
    const store = useRouteDetailStore()
    ;(store as any).activeRoute = {
      feedId: '886',
      routeId: '510',
      routeShortName: '510',
      routeLongName: 'Gold Line',
      routeColor: null,
      routeTextColor: null,
      routeType: 0,
      agencyName: null,
      stops: [
        makeStop('1', 'First', 35.22, -80.83, 0),
        makeStop('2', 'Second', 35.23, -80.84, 500),
        makeStop('3', 'Third', 35.24, -80.85, 1000),
      ],
      coordinates: null,
      relatedRouteIds: [],
    }

    // Default direction (first) — original order
    expect(store.displayStops[0].stopName).toBe('First')
    expect(store.displayStops[2].stopName).toBe('Third')

    // Switch to second direction — reversed
    store.setDirection(store.directions[1])
    expect(store.displayStops[0].stopName).toBe('Third')
    expect(store.displayStops[2].stopName).toBe('First')
  })
})

describe('vehicle projection', () => {
  test('vehiclesOnRoute is empty when no vehicles', () => {
    const store = useRouteDetailStore()
    ;(store as any).activeRoute = {
      feedId: '886',
      routeId: '510',
      routeShortName: '510',
      routeLongName: 'Gold Line',
      routeColor: null,
      routeTextColor: null,
      routeType: 0,
      agencyName: null,
      stops: [
        makeStop('1', 'A', 35.22, -80.83, 0),
        makeStop('2', 'B', 35.24, -80.85, 1000),
      ],
      coordinates: null,
      relatedRouteIds: [],
    }

    expect(store.vehiclesOnRoute).toHaveLength(0)
  })

  test('vehicleList reflects vehicles set on the store', () => {
    const store = useRouteDetailStore()
    expect(store.vehicleList).toHaveLength(0)

    ;(store as any).vehicles = new Map([
      ['v1', makeVehicle('v1', 35.22, -80.82, { routeId: '510' })],
      ['v2', makeVehicle('v2', 35.23, -80.83, { routeId: '510' })],
    ])

    expect(store.vehicleList).toHaveLength(2)
  })
})

describe('stopTimeMap', () => {
  test('empty when no trip stop times', () => {
    const store = useRouteDetailStore()
    expect(store.stopTimeMap.size).toBe(0)
  })
})

describe('generation counter guards', () => {
  test('closeRoute resets state even during loading', () => {
    const store = useRouteDetailStore()
    ;(store as any).isLoading = true
    store.closeRoute()
    expect(store.isActive).toBe(false)
    expect(store.vehicles.size).toBe(0)
  })
})
