/**
 * Unit tests for directions store
 *
 * Tests cover:
 * - Waypoint management (add, remove, reorder, set)
 * - Trips and trip selection
 * - Routing preferences
 * - Loading state
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useDirectionsStore } from './directions.store'
import type { TripsResponse } from '@/types/directions.types'
import type { Waypoint } from '@/types/map.types'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    clear: () => {
      store = {}
    },
  }
})()
global.localStorage = localStorageMock as any

describe('useDirectionsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
  })

  describe('Initial state', () => {
    test('starts with two empty waypoints', () => {
      const store = useDirectionsStore()
      
      expect(store.waypoints).toHaveLength(2)
      expect(store.waypoints[0].lngLat).toBeNull()
      expect(store.waypoints[1].lngLat).toBeNull()
    })

    test('starts with no trips or directions', () => {
      const store = useDirectionsStore()
      
      expect(store.trips).toBeNull()
      expect(store.directions).toBeNull()
      expect(store.selectedTripId).toBeNull()
    })

    test('starts with default mode', () => {
      const store = useDirectionsStore()
      
      expect(store.selectedMode).toBe('multi')
    })

    test('loads mode from localStorage if available', () => {
      localStorageMock.setItem('selectedMode', 'car')
      
      const store = useDirectionsStore()
      
      expect(store.selectedMode).toBe('car')
    })

    test('starts with default routing preferences', () => {
      const store = useDirectionsStore()
      
      expect(store.routingPreferences.avoidHighways).toBe(false)
      expect(store.routingPreferences.avoidTolls).toBe(false)
      expect(store.routingPreferences.maxWalkingDistance).toBe(1000)
      expect(store.routingPreferences.useKnownVehicleLocations).toBe(true)
    })
  })

  describe('setWaypoint', () => {
    test('sets waypoint at existing index', () => {
      const store = useDirectionsStore()
      const waypoint: Waypoint = {
        lngLat: { lat: 37.7749, lng: -122.4194 },
      }

      store.setWaypoint(0, waypoint)

      expect(store.waypoints[0]).toEqual(waypoint)
    })

    test('appends waypoint if index >= length', () => {
      const store = useDirectionsStore()
      const waypoint: Waypoint = {
        lngLat: { lat: 37.7749, lng: -122.4194 },
      }

      store.setWaypoint(5, waypoint)

      expect(store.waypoints).toHaveLength(3)
      expect(store.waypoints[2]).toEqual(waypoint)
    })
  })

  describe('setWaypoints', () => {
    test('replaces all waypoints', () => {
      const store = useDirectionsStore()
      const waypoints: Waypoint[] = [
        { lngLat: { lat: 37.7749, lng: -122.4194 } },
        { lngLat: { lat: 37.8044, lng: -122.2712 } },
        { lngLat: { lat: 37.7749, lng: -122.4194 } },
      ]

      store.setWaypoints(waypoints)

      expect(store.waypoints).toEqual(waypoints)
      expect(store.waypoints).toHaveLength(3)
    })
  })

  describe('removeWaypoint', () => {
    test('removes waypoint at index', () => {
      const store = useDirectionsStore()
      const waypoints: Waypoint[] = [
        { lngLat: { lat: 37.7749, lng: -122.4194 } },
        { lngLat: { lat: 37.8044, lng: -122.2712 } },
        { lngLat: { lat: 37.7749, lng: -122.4194 } },
      ]
      store.setWaypoints(waypoints)

      store.removeWaypoint(1)

      expect(store.waypoints).toHaveLength(2)
      expect(store.waypoints[0].lngLat).toEqual({ lat: 37.7749, lng: -122.4194 })
      expect(store.waypoints[1].lngLat).toEqual({ lat: 37.7749, lng: -122.4194 })
    })
  })

  describe('setTrips', () => {
    test('sets trips and auto-selects recommended trip', () => {
      const store = useDirectionsStore()
      const trips: TripsResponse = {
        request: { waypoints: [] },
        trips: [
          { id: 'trip-1', isRecommended: false } as any,
          { id: 'trip-2', isRecommended: true } as any,
          { id: 'trip-3', isRecommended: false } as any,
        ],
        earliestStart: new Date(0),
        latestEnd: new Date(0),
        metadata: { providers: [], processingTime: 0 },
      }

      store.setTrips(trips)

      expect(store.trips).toEqual(trips)
      expect(store.selectedTripId).toBe('trip-2')
    })

    test('auto-selects first trip if none recommended', () => {
      const store = useDirectionsStore()
      const trips: TripsResponse = {
        request: { waypoints: [] },
        trips: [
          { id: 'trip-1', isRecommended: false } as any,
          { id: 'trip-2', isRecommended: false } as any,
        ],
        earliestStart: new Date(0),
        latestEnd: new Date(0),
        metadata: { providers: [], processingTime: 0 },
      }

      store.setTrips(trips)

      expect(store.selectedTripId).toBe('trip-1')
    })

    test('does not set selectedTripId if no trips', () => {
      const store = useDirectionsStore()
      const trips: TripsResponse = {
        request: { waypoints: [] },
        trips: [],
        earliestStart: new Date(0),
        latestEnd: new Date(0),
        metadata: { providers: [], processingTime: 0 },
      }

      store.setTrips(trips)

      expect(store.selectedTripId).toBeNull()
    })
  })

  describe('unsetTrips', () => {
    test('clears trips and selectedTripId', () => {
      const store = useDirectionsStore()
      const trips: TripsResponse = {
        request: { waypoints: [] },
        trips: [{ id: 'trip-1', isRecommended: true } as any],
        earliestStart: new Date(0),
        latestEnd: new Date(0),
        metadata: { providers: [], processingTime: 0 },
      }
      store.setTrips(trips)

      store.unsetTrips()

      expect(store.trips).toBeNull()
      expect(store.selectedTripId).toBeNull()
    })
  })

  describe('setSelectedTripId', () => {
    test('sets selected trip id', () => {
      const store = useDirectionsStore()

      store.setSelectedTripId('trip-123')

      expect(store.selectedTripId).toBe('trip-123')
    })

    test('can clear selected trip id', () => {
      const store = useDirectionsStore()
      store.setSelectedTripId('trip-123')

      store.setSelectedTripId(null)

      expect(store.selectedTripId).toBeNull()
    })
  })

  describe('setLoading', () => {
    test('sets loading state', () => {
      const store = useDirectionsStore()

      store.setLoading(true)

      expect(store.isLoading).toBe(true)
    })
  })

  describe('setRoutingPreferences', () => {
    test('updates routing preferences', () => {
      const store = useDirectionsStore()
      const prefs = {
        ...store.routingPreferences,
        avoidHighways: true,
        avoidTolls: true,
      }

      store.setRoutingPreferences(prefs)

      expect(store.routingPreferences.avoidHighways).toBe(true)
      expect(store.routingPreferences.avoidTolls).toBe(true)
    })
  })

  describe('localStorage persistence', () => {
    test('saves selectedMode to localStorage on change', async () => {
      const store = useDirectionsStore()

      store.selectedMode = 'biking'
      await nextTick()
      await nextTick() // Wait for watcher to trigger
      
      expect(localStorageMock.getItem('selectedMode')).toBe('biking')
    })

    test('saves routingPreferences to localStorage on change', async () => {
      const store = useDirectionsStore()

      store.routingPreferences.avoidHighways = true
      await nextTick()
      await nextTick() // Wait for watcher to trigger
      
      const stored = localStorageMock.getItem('routingPreferences')
      expect(stored).toBeTruthy()
      const parsed = JSON.parse(stored!)
      expect(parsed.avoidHighways).toBe(true)
    })
  })
})
